/**
 * The manager's calls to the manage routes (docs §4.9), one function per
 * action so the screen and its tests name the same routes. Each throws
 * `ApiClientError`; the screen words the failure. The routes are the scope's
 * (`/api/admin/invoice-templates` or `/api/vendor/invoice-templates`,
 * template-scope.tsx); `templatesApi` and `templateHref` are the admin's.
 */
import { apiClient } from "@/lib/api/client";
import type { InvoiceTemplate, TemplateCategory, TemplateLocale } from "@/lib/invoice-templates/types";
import { ADMIN_TEMPLATE_SCOPE } from "../template-scope";

export function templatesApiFor(base: string) {
  return {
    list: () => apiClient.get<InvoiceTemplate[]>(base),
    /** A preset saved as it is, in a language — the server builds its design. */
    createFromPreset: (input: { category: TemplateCategory; name: string; presetKey: string; locale: TemplateLocale }) =>
      apiClient.post<InvoiceTemplate>(base, input),
    /** A rename is a save, so it names the version the admin was looking at. */
    rename: (template: Pick<InvoiceTemplate, "id" | "version">, name: string) =>
      apiClient.patch<InvoiceTemplate>(`${base}/${template.id}`, {
        version: template.version,
        name,
      }),
    duplicate: (id: string) => apiClient.post<InvoiceTemplate>(`${base}/${id}/duplicate`, {}),
    setDefault: (id: string) => apiClient.post<InvoiceTemplate>(`${base}/${id}/default`, {}),
    removeDefault: (id: string) => apiClient.delete<InvoiceTemplate>(`${base}/${id}/default`),
    restorePreset: (template: Pick<InvoiceTemplate, "id" | "version">) =>
      apiClient.post<InvoiceTemplate>(`${base}/${template.id}/restore-preset`, { version: template.version }),
    remove: (id: string) => apiClient.delete<{ deleted: boolean; wasDefault: boolean; category: string }>(`${base}/${id}`),
  };
}

export type TemplatesApi = ReturnType<typeof templatesApiFor>;

export const templatesApi: TemplatesApi = templatesApiFor(ADMIN_TEMPLATE_SCOPE.templatesEndpoint);

/** Where the admin manager's links go. Locale-less: `Link` and `useRouter` add the language. */
export const templateHref = ADMIN_TEMPLATE_SCOPE.href;
