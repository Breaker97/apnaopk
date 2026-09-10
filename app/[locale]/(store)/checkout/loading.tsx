import { CheckoutSkeleton } from "@/components/checkout/checkout-skeleton";

// Route-level fallback shown instantly on navigation (cart -> checkout) so the
// previous page doesn't sit frozen while the segment loads.
//
// This renders the exact same component as the <Suspense> fallback inside
// checkout/page.tsx on purpose. The two run back to back — route fallback, then
// the SSR bail-out for CheckoutContent's useSearchParams() — so anything other
// than one shared skeleton would show two different loading frames in a row.
//
// checkout/ has no child routes, so this boundary cannot leak into a nested
// page the way segment-level loading files did before the (list) route groups.
export default function CheckoutLoading() {
  return <CheckoutSkeleton />;
}
