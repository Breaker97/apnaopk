import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { appConfig } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { Separator } from "@/components/ui/separator";
import { StickySidebar } from "@/components/ui/sticky-sidebar";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductFiltersLazy } from "@/components/products/product-filters-lazy";
import { ProductFiltersMobileLazy } from "@/components/products/product-filters-mobile-lazy";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { ProductsSort } from "@/components/products/products-sort";
import { VendorSimilarProducts } from "@/components/store/vendor-similar-products";
import { VendorReviewsPanel } from "@/components/store/vendor-reviews-panel";
import {
  VendorAboutPanel,
  VendorShippingPanel,
} from "@/components/store/vendor-info-panels";
import {
  VendorStorefrontTabs,
  normalizeVendorTab,
} from "@/components/store/vendor-storefront-tabs";
import { getStorefrontVendorReviews } from "@/lib/vendors/vendor-reviews";
import { isFollowingVendor } from "@/lib/vendors/vendor-follow";
import { VendorFollowButton } from "@/components/store/vendor-follow-button";
import { StorefrontChatButton } from "@/components/chat/storefront-chat-button";
import { VendorExternalChannels } from "@/components/chat/vendor-external-channels";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import {
  VendorStoreInfo,
  VendorStoreInfoMobile,
  type VendorStoreInfoLabels,
} from "@/components/store/vendor-store-info";
import {
  VendorStorefrontHeader,
  formatVendorCount,
} from "@/components/store/vendor-storefront-header";
import { getStorefrontProductFilters } from "@/lib/products/storefront-product-filters";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import {
  getStorefrontIcons,
  getStorefrontMetadataSettings,
  buildStorefrontAlternates,
  normalizeMetadataText,
  truncateMetadataText,
} from "@/lib/storefront/storefront-metadata";
import {
  getStorefrontVendorBySlug,
  type StorefrontVendor,
} from "@/lib/storefront/storefront-vendors";
import {
  VENDOR_ADDRESS_DISPLAY,
  formatVendorAddress,
} from "@/lib/vendors/vendor-address";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";
import { normalizeRequestSortBy } from "@/lib/locations/shopper-location";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function resolveBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const [vendor, storeMetadata] = await Promise.all([
    getStorefrontVendorBySlug(String(slug)),
    getStorefrontMetadataSettings(),
  ]);

  if (!vendor) return {};

  const baseUrl = resolveBaseUrl();
  const page = `/vendors/${slug}`;
  const address = formatVendorAddress(
    vendor.address,
    vendor.addressDisplay,
    locale,
  );

  const title = normalizeMetadataText(vendor.storeName) || storeMetadata.storeName;
  // A store's own words first; otherwise a description that at least says where
  // it trades from, which tells a searcher more than a bare store name.
  const description =
    truncateMetadataText(
      normalizeMetadataText(
        vendor.description ||
          (address?.short
            ? `Shop ${vendor.storeName} — ${address.short}.`
            : `Shop products from ${vendor.storeName}.`),
      ),
      160,
    ) || appConfig.description;

  // Vendor artwork, then the store's OG image. No bundled fallback — the app's
  // own branding must never stand in for a merchant's link preview.
  const images = vendor.banner
    ? [vendor.banner]
    : vendor.logo
      ? [vendor.logo]
      : storeMetadata.seo.ogImage
        ? [storeMetadata.seo.ogImage]
        : [];

  const twitterHandle = storeMetadata.social?.twitterHandle;

  return {
    title,
    description,
    metadataBase: new URL(baseUrl),
    alternates: await buildStorefrontAlternates({ locale, page }),
    openGraph: {
      type: "website",
      title,
      description,
      url: `${baseUrl}/${locale}${page}`,
      siteName: storeMetadata.storeName,
      images:
        images.length > 0
          ? images.map((url) => ({ url, alt: vendor.storeName }))
          : undefined,
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.length > 0 ? images : undefined,
      ...(twitterHandle ? { site: `@${twitterHandle}` } : {}),
    },
    icons: getStorefrontIcons(storeMetadata),
  };
}

/**
 * LocalBusiness structured data. This is the single biggest search payoff of
 * publishing an address: it lets Google resolve local intent ("appliance store
 * in Banani") instead of treating the page as a generic listing.
 *
 * The precision follows the vendor's own choice — a full `PostalAddress` only
 * when they opted into `full`, and locality + country otherwise.
 */
function buildStoreJsonLd({
  vendor,
  url,
  locale,
}: {
  vendor: StorefrontVendor;
  url: string;
  locale: string;
}) {
  const address = formatVendorAddress(
    vendor.address,
    vendor.addressDisplay,
    locale,
  );

  const postalAddress = vendor.address
    ? {
        "@type": "PostalAddress",
        ...(vendor.addressDisplay === VENDOR_ADDRESS_DISPLAY.FULL
          ? {
              streetAddress: vendor.address.street,
              postalCode: vendor.address.postalCode,
              addressRegion: vendor.address.state,
            }
          : {}),
        addressLocality: vendor.address.city,
        addressCountry: vendor.address.country,
      }
    : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Store",
    name: vendor.storeName,
    url,
    ...(vendor.description ? { description: vendor.description } : {}),
    ...(vendor.logo ? { logo: vendor.logo } : {}),
    ...(vendor.banner ? { image: vendor.banner } : {}),
    ...(postalAddress ? { address: postalAddress } : {}),
    // The geocoded point, so search engines place the store exactly rather than
    // re-deriving a position from the address text. Only ever present at `full`
    // precision — `formatVendorAddress` withholds it otherwise.
    ...(address?.coordinates
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: address.coordinates.lat,
            longitude: address.coordinates.lng,
          },
        }
      : {}),
    ...(vendor.phone ? { telephone: vendor.phone } : {}),
    ...(vendor.socialProfiles.length > 0
      ? { sameAs: vendor.socialProfiles.map((profile) => profile.url) }
      : {}),
    // Google discards an AggregateRating with no reviewCount, so both are
    // emitted or neither is.
    ...(vendor.rating > 0 && vendor.reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: vendor.rating,
            reviewCount: vendor.reviewCount,
            bestRating: 5,
          },
        }
      : {}),
    // Keeps the address block honest for consumers that read it as a location.
    ...(address?.short ? { areaServed: address.short } : {}),
  };
}

export default async function VendorStorefrontPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, slug } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const location = resolveRequestLocation(search);
  const [t, vendor, filters, { headerSettings }] = await Promise.all([
    getTranslations({ locale }),
    getStorefrontVendorBySlug(String(slug)),
    getStorefrontProductFilters({ vendor: String(slug) }),
    getStorefrontSettings(),
  ]);

  if (!vendor) notFound();

  // The grid below already honours every location param, so the filter panel
  // offers the controls that set them. The header's "Deliver to" is a
  // different control for a different question and does not narrow this list.
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);
  const showPickupFacet = showLocation;

  const tr = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

  /**
   * Same as `tr`, for messages carrying placeholders. The values go through
   * `t()` so ICU handles them; the English fallback (used by locales that have
   * not been translated yet) is interpolated by hand.
   *
   * Fetching a message like "{count} products" via `t(key)` with no values makes
   * next-intl raise MISSING_FORMAT_VALUE and render the key path instead, so the
   * two paths must never be mixed up.
   */
  const trv = (
    key: string,
    fallback: string,
    values: Record<string, string | number>,
  ) => {
    if (t.has(key)) return t(key, values);
    return Object.entries(values).reduce(
      (out, [name, value]) => out.split(`{${name}}`).join(String(value)),
      fallback,
    );
  };

  /**
   * For templates whose {placeholders} are substituted by the component that
   * receives them, rather than here: `t.raw` returns the message unformatted,
   * where `t(key)` would raise MISSING_FORMAT_VALUE and render the key path.
   */
  const traw = (key: string, fallback: string) =>
    t.has(key) ? String(t.raw(key)) : fallback;

  const category =
    typeof search.category === "string" ? search.category : undefined;
  const collection =
    typeof search.collection === "string" ? search.collection : undefined;
  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;
  const minPrice =
    typeof search.minPrice === "string" ? search.minPrice : undefined;
  const maxPrice =
    typeof search.maxPrice === "string" ? search.maxPrice : undefined;
  const sortBy =
    normalizeRequestSortBy(
      typeof search.sortBy === "string" ? search.sortBy : undefined,
      search,
    ) || "popular";
  const page = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const activeTab = normalizeVendorTab(search.tab);
  const reviewPage =
    typeof search.reviewPage === "string"
      ? Math.max(1, parseInt(search.reviewPage, 10) || 1)
      : 1;
  const basePath = `/${locale}/vendors/${vendor.slug}`;

  // Reviews are fetched only for the tab that shows them — the Products tab has
  // no use for the list, and the header's count comes from the vendor payload.
  const reviews =
    activeTab === "reviews"
      ? await getStorefrontVendorReviews({
          vendorId: vendor.id,
          page: reviewPage,
        })
      : null;

  // Follow state is per-viewer, so it is resolved outside the cached vendor
  // payload — that cache is shared across every visitor.
  const session = await auth.api.getSession({ headers: await headers() });
  const isFollowing = await isFollowingVendor({
    vendorId: vendor.id,
    userId: session?.user?.id,
  });

  // The address is formatted here, not in the cached data layer: country names
  // and line order are locale-dependent, and the vendor payload is cached once
  // for all 18 locales. Gating already happened server-side — anything the
  // vendor chose not to publish never reached this component.
  const address = formatVendorAddress(
    vendor.address,
    vendor.addressDisplay,
    locale,
  );

  // Month + year, e.g. "Mar 2024". A bare year reads as vaguer than the data
  // actually is, and `Intl` keeps the month name in the reader's locale.
  const memberSinceValue = vendor.memberSince
    ? new Intl.DateTimeFormat(locale, {
        month: "short",
        year: "numeric",
      }).format(new Date(vendor.memberSince))
    : "";

  const shipsLabel = !vendor.processingDays
    ? ""
    : vendor.processingDays.max <= 1
      ? tr("vendor.storefront.shipsInSameDay", "Ships same day")
      : trv("vendor.storefront.shipsIn", "Ships in {min}–{max} days", {
          min: Math.max(1, vendor.processingDays.min || 1),
          max: vendor.processingDays.max,
        });

  const pickupDaysMax = vendor.pickup?.readyInDaysMax ?? 0;
  const pickupReadyLabel =
    pickupDaysMax > 0
      ? trv("vendor.storefront.pickupReady", "Ready in {min}–{max} days", {
          min: vendor.pickup?.readyInDaysMin ?? pickupDaysMax,
          max: pickupDaysMax,
        })
      : "";

  const storeInfoLabels: VendorStoreInfoLabels = {
    heading: tr("vendor.storefront.storeInfo", "Store information"),
    address: tr("vendor.storefront.address", "Address"),
    basedIn: tr("vendor.storefront.basedIn", "Based in"),
    pickup: tr("vendor.storefront.localPickup", "Local pickup"),
    pickupReady: pickupReadyLabel,
    online: tr("vendor.storefront.online", "Online"),
    phone: tr("vendor.storefront.phone", "Phone"),
    copy: tr("vendor.storefront.copyAddress", "Copy"),
    copied: tr("vendor.storefront.addressCopied", "Address copied"),
    directions: tr("vendor.storefront.getDirections", "Directions"),
  };

  const storeInfoData = {
    addressLines: address?.lines,
    mapQuery: address?.mapQuery,
    mapCoordinates: address?.coordinates,
    phone: vendor.phone,
    pickup: vendor.pickup,
    socialProfiles: vendor.socialProfiles,
  };

  const jsonLd = buildStoreJsonLd({
    vendor,
    url: `${resolveBaseUrl()}/${locale}/vendors/${vendor.slug}`,
    locale,
  });

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      <script
        type="application/ld+json"
        // Serialized server-side from our own gated data; no user HTML involved.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* There is no /vendors index to link to, so the trail is short by
          design — its job here is the way back out of a seller's storefront,
          which nothing else on this page offers. */}
      <StoreBreadcrumb
        className="mb-4"
        locale={locale}
        items={[{ label: vendor.storeName }]}
      />

      <VendorStorefrontHeader
        vendor={vendor}
        location={address?.short}
        followAction={
          <VendorFollowButton
            slug={vendor.slug}
            initialIsFollowing={isFollowing}
            isAuthenticated={Boolean(session?.user?.id)}
            locale={locale}
            labels={{
              follow: tr("vendor.storefront.follow", "Follow"),
              following: tr("vendor.storefront.following", "Following"),
              followed: tr("vendor.storefront.followed", "Following this store"),
              unfollowed: tr(
                "vendor.storefront.unfollowed",
                "Unfollowed this store",
              ),
              loginRequired: tr(
                "vendor.storefront.followLogin",
                "Sign in to follow stores",
              ),
              error: tr("common.error", "Something went wrong"),
            }}
          />
        }
        contactAction={
          <>
            {vendor.messaging.liveChatEnabled ? (
              <StorefrontChatButton
                compact
                variant="ghost"
                locale={locale}
                vendorId={vendor.id}
                vendorName={vendor.storeName}
                label={tr("chat.chatWithVendor", "Chat with vendor")}
              />
            ) : null}
            <VendorExternalChannels
              compact
              variant="ghost"
              settings={vendor.messaging}
              vendorName={vendor.storeName}
              chatOnLabel={traw(
                "chat.externalChannels.chatOn",
                "Chat with {vendor} on {channel}",
              )}
              whatsappStoreMessage={traw(
                "chat.externalChannels.whatsappStoreMessage",
                "Hello {vendor}, I have a question about your store.",
              )}
            />
          </>
        }
        labels={{
          reviews:
            vendor.reviewCount > 0
              ? trv("vendor.storefront.reviewCount", "({count} reviews)", {
                  count: vendor.reviewCount.toLocaleString(locale),
                })
              : "",
          sold: trv("vendor.storefront.sold", "{count} sold", {
            count: formatVendorCount(vendor.unitsSold, locale),
          }),
          ships: shipsLabel,
          pickupAvailable: tr(
            "vendor.storefront.pickupAvailable",
            "Pickup available",
          ),
          verified: tr("vendor.storefront.verified", "Verified vendor"),
          share: tr("product.share.label", "Share"),
        }}
      />

      {/* Mobile: full address one tap away, so products stay near the fold. */}
      <VendorStoreInfoMobile
        {...storeInfoData}
        labels={storeInfoLabels}
        triggerLabel={tr(
          "vendor.storefront.storeDetails",
          "Store details & address",
        )}
        className="mt-6 sm:mt-8"
      />

      <div className="mt-6 sm:mt-8">
        <VendorStorefrontTabs
          active={activeTab}
          basePath={basePath}
          locale={locale}
          labels={{
            products: tr("common.products", "Products"),
            about: tr("vendor.storefront.tabAbout", "About"),
            shipping: tr(
              "vendor.storefront.tabShipping",
              "Shipping & returns",
            ),
            reviews: tr("common.reviews", "Reviews"),
          }}
          counts={{
            products: vendor.productCount,
            reviews: vendor.reviewCount,
          }}
        />
      </div>

      {activeTab === "about" ? (
        <div className="mt-6 sm:mt-8">
          <VendorAboutPanel
            vendor={vendor}
            storeInfo={storeInfoData}
            storeInfoLabels={storeInfoLabels}
            labels={{
              aboutHeading: trv("vendor.storefront.aboutStore", "About {store}", {
                store: vendor.storeName,
              }),
              noDescription: tr(
                "vendor.storefront.noDescription",
                "This store has not added a description yet.",
              ),
              productsLabel: tr("common.products", "Products"),
              productsValue: vendor.productCount.toLocaleString(locale),
              soldLabel: tr("vendor.storefront.unitsSold", "Units sold"),
              soldValue: formatVendorCount(vendor.unitsSold, locale),
              memberLabel: tr("vendor.storefront.memberSinceLabel", "Selling since"),
              memberValue: memberSinceValue,
              statusLabel: tr("vendor.storefront.statusLabel", "Status"),
              verified: tr("vendor.storefront.verified", "Verified vendor"),
            }}
          />
        </div>
      ) : null}

      {activeTab === "shipping" ? (
        <div className="mt-6 sm:mt-8">
          <VendorShippingPanel
            vendor={vendor}
            location={address?.short}
            labels={{
              shippingHeading: tr(
                "vendor.storefront.tabShipping",
                "Shipping & returns",
              ),
              processingHeading: tr(
                "vendor.storefront.processingTime",
                "Processing time",
              ),
              processing: shipsLabel,
              processingHint: tr(
                "vendor.storefront.processingUnset",
                "This store has not published a dispatch window yet.",
              ),
              pickupHeading: tr("vendor.storefront.localPickup", "Local pickup"),
              pickupReady: pickupReadyLabel,
              pickupUnavailable: tr(
                "vendor.storefront.pickupUnavailable",
                "Local pickup is not offered by this store.",
              ),
              locationHeading: tr("vendor.storefront.shipsFrom", "Ships from"),
              noLocation: tr(
                "vendor.storefront.noLocation",
                "This store keeps its location private.",
              ),
            }}
          />
        </div>
      ) : null}

      {activeTab === "reviews" && reviews ? (
        <div className="mt-6 sm:mt-8">
          <VendorReviewsPanel
            data={reviews}
            locale={locale}
            basePath={basePath}
            labels={{
              heading: tr("common.reviews", "Reviews"),
              basedOn: trv(
                "vendor.storefront.basedOnReviews",
                "Based on {count} reviews",
                {
                  count: (reviews.total > 0
                    ? reviews.total
                    : vendor.reviewCount
                  ).toLocaleString(locale),
                },
              ),
              verifiedPurchase: tr(
                "vendor.storefront.verifiedPurchase",
                "Verified purchase",
              ),
              storeReplied: tr(
                "vendor.storefront.storeReplied",
                "Response from the store",
              ),
              empty: tr("vendor.storefront.noReviews", "No reviews yet"),
              emptyHint: tr(
                "vendor.storefront.noReviewsHint",
                "Reviews appear here once buyers have received their orders.",
              ),
            }}
          />
        </div>
      ) : null}

      {activeTab !== "products" ? null : (
      <div className="mt-6 grid grid-cols-1 gap-8 sm:mt-8 lg:grid-cols-[288px_1fr] lg:gap-10">
        {/* Pinned by measurement rather than scrolled inside itself. A store
            with many categories makes this column taller than the viewport, and
            a plain sticky block pins its top and hides its own bottom — but
            giving it its own `overflow-y` traded that for a scrollbar sitting
            on top of a 288px-wide panel, clipping the location controls and the
            radius row. <StickySidebar> is what the products page uses for the
            same panel: it rides up with the page until its bottom is in view,
            then pins. See the offset it computes. */}
        <StickySidebar className="hidden space-y-6 lg:block">
          <VendorStoreInfo
            {...storeInfoData}
            labels={storeInfoLabels}
            variant="plain"
          />

          <Separator />

          <ProductFiltersLazy
            locale={locale as Locale}
            categories={filters.categories}
            collections={filters.collections}
            priceRange={filters.priceRange}
            currentCategory={category}
            currentCollection={collection}
            currentMinPrice={minPrice}
            currentMaxPrice={maxPrice}
            currentSort={sortBy}
            showSort={false}
            showLocation={showLocation}
            showPickupFacet={showPickupFacet}
            currentPickupNearby={location.pickupNearby}
          />
        </StickySidebar>

        <div className="min-w-0">
          <ProductFiltersMobileLazy
            locale={locale as Locale}
            categories={filters.categories}
            collections={filters.collections}
            priceRange={filters.priceRange}
            currentCategory={category}
            currentCollection={collection}
            currentMinPrice={minPrice}
            currentMaxPrice={maxPrice}
            currentSort={sortBy}
            showLocation={showLocation}
            showPickupFacet={showPickupFacet}
            currentPickupNearby={location.pickupNearby}
          />

          {/* Toolbar. The count reframes a small store: two products in a
              four-column grid reads as a broken page without it. */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {trv(
                "vendor.storefront.productCountInStore",
                "{count} products in this store",
                { count: vendor.productCount.toLocaleString(locale) },
              )}
            </p>

            <ProductsSort
              currentSort={sortBy}
              labels={{
                label: tr("product.sortBy", "Sort by"),
                mostPopular: tr(
                  "productsPage.filters.sortOptions.mostPopular",
                  "Most popular",
                ),
                bestRating: tr(
                  "productsPage.filters.sortOptions.bestRating",
                  "Best rating",
                ),
                newest: tr("productsPage.filters.sortOptions.newest", "Newest"),
                priceLowHigh: tr(
                  "productsPage.filters.sortOptions.priceLowHigh",
                  "Price: low to high",
                ),
                priceHighLow: tr(
                  "productsPage.filters.sortOptions.priceHighLow",
                  "Price: high to low",
                ),
              }}
            />
          </div>

          <Suspense fallback={<ProductSkeleton count={8} />}>
            <ProductGrid
              locale={locale as Locale}
              vendor={vendor.slug}
              category={category}
              collection={collection}
              search={searchQuery}
              minPrice={minPrice}
              maxPrice={maxPrice}
              sortBy={sortBy}
              page={page}
              lat={location.lat}
              lng={location.lng}
              radius={location.radius}
              city={location.city}
              pickupNearby={location.pickupNearby}
              emptyMessage={t("vendor.storefront.noProducts")}
            />
          </Suspense>

          {/* Streams in separately so a small store's grid is never held back
              waiting on cross-store suggestions. */}
          <Suspense fallback={null}>
            <VendorSimilarProducts
              vendorId={vendor.id}
              categoryIds={filters.categoryIds}
              locale={locale as Locale}
              location={location}
              title={tr(
                "vendor.storefront.similarProducts",
                "Similar products from other stores",
              )}
            />
          </Suspense>
        </div>
      </div>
      )}
    </div>
  );
}
