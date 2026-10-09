import Link from "@/components/language/link";
import { Layers } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AppImage } from "@/components/ui/app-image";
import { type Locale } from "@/config/i18n.config";
import { getStorefrontCollections } from "@/lib/storefront/storefront-collections";
import { vendorFilterHref } from "@/lib/vendors/vendor-store-page";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";
import { SectionHeading } from "./section-shell";

interface CollectionListProps {
  locale: Locale;
  title: string;
  limit: number;
  /**
   * A vendor's landing page: the collections that store sells in, each
   * opening its own Products tab filtered to it, with its own product count.
   */
  vendor?: { id: string; slug: string };
}

/** Collection cards in position order, linking through to each collection. */
export async function CollectionList({
  locale,
  title,
  limit,
  vendor,
}: CollectionListProps) {
  const collections: {
    _id: unknown;
    title: string;
    slug: string;
    image?: unknown;
    productCount?: number;
    href?: string;
  }[] = vendor
    ? ((await getVendorStoreTaxonomy(vendor.id).catch(() => null))?.collections ?? [])
        .slice(0, Math.max(1, limit))
        .map((collection) => ({
          _id: collection.id,
          title: collection.title,
          slug: collection.slug,
          image: collection.image,
          productCount: collection.productCount,
          href: vendorFilterHref(locale, vendor.slug, "collection", collection.slug),
        }))
    : (await getStorefrontCollections({ page: 1, limit })).data;
  if (collections.length === 0) return null;

  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <SectionHeading title={title} className="mb-6" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {collections.map((collection) => {
            // A collection's image is a { url, alt } document, not a string —
            // handing the whole object to AppImage crashed the section for
            // any collection that actually had one.
            const image = collection.image as
              | { url?: string; alt?: string }
              | undefined;
            return (
            <Link
              key={String(collection._id)}
              href={collection.href ?? `/collections/${collection.slug}`}
              className="group overflow-hidden rounded-md border border-border/70 bg-card transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-[4/3] bg-muted">
                {image?.url ? (
                  <AppImage
                    src={image.url}
                    alt={image.alt || collection.title}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(min-width: 1024px) 25vw, 50vw"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                    <Layers className="h-6 w-6" aria-hidden />
                  </div>
                )}
              </div>
              <div className="space-y-0.5 p-3">
                <p className="truncate text-sm font-semibold text-foreground">
                  {collection.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("collectionProductsCount", {
                    count: collection.productCount ?? 0,
                  })}
                </p>
              </div>
            </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
