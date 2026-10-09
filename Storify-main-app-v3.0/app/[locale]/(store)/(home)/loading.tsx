import { locale as rootLocale } from "next/root-params";
import type { Locale } from "@/config/i18n.config";
import { StoreSectionSkeletons } from "@/components/store/store-sections";
import { getHomePageRender } from "@/lib/storefront/pages/get-home-page";

// Route-level fallback shown while the page shell resolves. It reads the same
// published document the page renders and draws each visible section's own
// skeleton in the page's order, so a section the merchant hid (or left
// unassigned) never paints a placeholder first. These are the very
// skeletons the page's per-section <Suspense> boundaries show next, so the
// hand-over is seamless. A hard-coded list used to stand here; it mirrored
// one default arrangement whatever the store actually showed.
//
// Both reads are cached, so the frame costs no query of its own. A loading
// file gets no params, hence the locale from the route's root param — not
// next-intl's `getLocale`, which falls back to reading the request when this
// renders before the layout has set it, and would make the cached home page a
// per-request one.
//
// Lives in the (home) route group on purpose. At the (store) segment level a
// loading.tsx also wraps every nested route, so these home-only skeletons were
// painting as the first frame of /products/[slug], /cart, /checkout and every
// other store page before that route's own fallback took over. The group scopes
// the boundary to this page alone.
export default async function StoreLoading() {
  const { sections, ctx } = await getHomePageRender(
    (await rootLocale()) as Locale,
  );

  return (
    <div className="animate-in fade-in duration-200" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading store...
      </p>

      <StoreSectionSkeletons sections={sections} ctx={ctx} />
    </div>
  );
}
