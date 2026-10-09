import { locale as rootLocale } from "next/root-params";
import type { Locale } from "@/config/i18n.config";
import { StoreSectionSkeletons } from "@/components/store/store-sections";
import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import type {
  SectionInstance,
  SectionRenderContext,
} from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

/** The product template and the context its skeletons draw in; null if unreadable. */
async function readProductTemplate(): Promise<{
  sections: SectionInstance[];
  ctx: SectionRenderContext;
} | null> {
  try {
    const [locale, template, storefront] = await Promise.all([
      rootLocale(),
      getTemplateSections("product"),
      getStorefrontSettings(),
    ]);
    return {
      sections: template.sections,
      ctx: {
        locale: locale as Locale,
        defaultLanguage: storefront.defaultLanguage,
        isMultiVendorEnabled: storefront.isMultiVendorEnabled,
        themeId: storefront.theme.id,
        themeSettings: storefront.theme.settings,
        templateType: "product",
      },
    };
  } catch {
    return null;
  }
}

// Route-level fallback shown instantly on navigation while the server resolves
// the product query + metadata. It draws the product template's own section
// skeletons in the template's order — the ones the page's per-section
// boundaries show next — so a section the merchant hid (reviews, related
// products) never paints a placeholder first. A hard-coded buy box, reviews
// and related row used to stand here whatever the template held.
//
// Both reads are cached. A loading file gets no params, hence the locale from
// the route's root param — not next-intl's `getLocale`, which falls back to
// reading the request when this renders before the layout has set it, and
// would make the cached product page a per-request one. If the reads fail,
// the frame stays bare rather than erroring in the page's place.
export default async function ProductDetailLoading() {
  const template = await readProductTemplate();

  return (
    <div className="pb-8 lg:pb-10" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading product...
      </p>

      {template ? (
        <StoreSectionSkeletons sections={template.sections} ctx={template.ctx} />
      ) : null}
    </div>
  );
}
