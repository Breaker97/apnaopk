"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whose templates the manager, the editor and the preview work on (Phase 7,
 * D-07), as the store builder's `builder-scope.tsx` does for pages: the
 * admin's Settings → Invoice Settings and the vendor owner's Store settings →
 * Invoice Settings mount the same components, and the scope is the only thing
 * that differs between them — which routes they call and where their links go.
 *
 * The admin scope is the default — every value below is exactly what the
 * components hard-coded before scopes existed — so the admin screens need no
 * provider and behave as they always have. The server decides whose
 * templates a route serves (from the session); the scope only picks the route.
 */
export interface InvoiceTemplateScope {
  kind: "admin" | "vendor";
  /**
   * The manage routes: GET lists, POST creates, `/<id>` reads, saves and
   * deletes, `/<id>/duplicate|default|restore-preset` run the actions.
   */
  templatesEndpoint: string;
  /**
   * The caller's own orders, for a preview or a test print with a real order:
   * `?search=` finds one by its number, `/<id>/print-context` gives its
   * render context — the vendor's own consignment on the vendor's side.
   */
  ordersEndpoint: string;
  /** Where the screens link. Locale-less: `Link` and `useRouter` add the language. */
  href: {
    list: (category?: string) => string;
    edit: (id: string) => string;
    preview: (id: string) => string;
    /** A built-in preset's preview, in a language. */
    previewPreset: (preset: string, lang: string) => string;
    /** An unsaved draft: blank, or from a preset in a language. */
    create: (category: string, options?: { preset?: string; lang?: string }) => string;
  };
}

function hrefs(listPath: string, editorBase: string): InvoiceTemplateScope["href"] {
  return {
    list: (category) => `${listPath}${category ? `?category=${category}` : ""}`,
    edit: (id) => `${editorBase}/${id}/edit`,
    preview: (id) => `${editorBase}/preview?id=${id}`,
    previewPreset: (preset, lang) => `${editorBase}/preview?${new URLSearchParams({ preset, lang }).toString()}`,
    create: (category, options = {}) => {
      const params = new URLSearchParams({ category });
      if (options.preset) params.set("preset", options.preset);
      if (options.lang) params.set("lang", options.lang);
      return `${editorBase}/new?${params.toString()}`;
    },
  };
}

export const ADMIN_TEMPLATE_SCOPE: InvoiceTemplateScope = {
  kind: "admin",
  templatesEndpoint: "/api/admin/invoice-templates",
  ordersEndpoint: "/api/admin/orders",
  href: hrefs("/admin/settings/invoices", "/admin/invoice-templates"),
};

/**
 * The signed-in vendor owner's own templates. Their prints — their order
 * page and their POS — use their default, else the platform's (§4.8).
 */
export const VENDOR_TEMPLATE_SCOPE: InvoiceTemplateScope = {
  kind: "vendor",
  templatesEndpoint: "/api/vendor/invoice-templates",
  ordersEndpoint: "/api/vendor/orders",
  href: hrefs("/vendor/settings/invoices", "/vendor/invoice-templates"),
};

export const TEMPLATE_SCOPES = {
  admin: ADMIN_TEMPLATE_SCOPE,
  vendor: VENDOR_TEMPLATE_SCOPE,
} as const;

export type TemplateScopeKey = keyof typeof TEMPLATE_SCOPES;

const TemplateScopeContext = createContext<InvoiceTemplateScope>(ADMIN_TEMPLATE_SCOPE);

/**
 * Puts the screens below it on a scope. Takes the scope's key, not the object,
 * so a server page can choose it (functions don't cross to the client).
 */
export function InvoiceTemplateScopeProvider({ scope, children }: { scope: TemplateScopeKey; children: ReactNode }) {
  return <TemplateScopeContext.Provider value={TEMPLATE_SCOPES[scope]}>{children}</TemplateScopeContext.Provider>;
}

export function useTemplateScope(): InvoiceTemplateScope {
  return useContext(TemplateScopeContext);
}
