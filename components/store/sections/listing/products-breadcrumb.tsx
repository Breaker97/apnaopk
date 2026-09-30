import { type Locale } from "@/config/i18n.config";
import { useTranslations } from "next-intl";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";

type ProductsBreadcrumbCrumb = { label: string; href?: string };

/**
 * The products listing's trail. Rendered by the page route above the
 * sections — or, when the listing's cover carries it, inside the cover —
 * so both places must describe the page the same way.
 *
 * A search narrows this listing rather than leaving it, so "Products"
 * becomes the link back to the unfiltered grid and the query takes the
 * current-page slot. A category opened on the listing is a place, and its
 * `trail` (the category and its ancestors, from `listingCategoryTrail`)
 * sits between the two.
 */
export function ProductsBreadcrumb({
  locale,
  storeDefault,
  searchQuery,
  trail = [],
  className,
  jsonLd = true,
}: {
  locale: string;
  /** The language served without a URL prefix — see `StoreBreadcrumb`. */
  storeDefault: Locale;
  searchQuery?: string;
  /** The category the listing is opened on, with its ancestors before it. */
  trail?: ProductsBreadcrumbCrumb[];
  className?: string;
  jsonLd?: boolean;
}) {
  const t = useTranslations();
  const narrowed = searchQuery || trail.length > 0;
  return (
    <StoreBreadcrumb
      className={className}
      locale={locale}
      storeDefault={storeDefault}
      jsonLd={jsonLd}
      items={[
        narrowed
          ? { label: t("nav.products"), href: "/products" }
          : { label: t("nav.products") },
        ...trail,
        ...(searchQuery
          ? [{ label: `${t("common.search")}: "${searchQuery}"` }]
          : []),
      ]}
    />
  );
}
