import { CheckoutSkeleton } from "@/components/checkout/checkout-skeleton";

// Route-level fallback shown instantly on navigation (cart -> checkout) so the
// previous page doesn't sit frozen while the segment loads.
//
// This renders the exact same component as the <Suspense> fallback inside
// checkout/page.tsx on purpose. The two run back to back — route fallback, then
// the SSR bail-out for CheckoutContent's useSearchParams() — so anything other
// than one shared skeleton would show two different loading frames in a row.
//
// It lives in the (form) route group so it wraps the checkout page alone. At
// checkout/ level it also wrapped checkout/success, so placing an order flashed
// this checkout-form skeleton before the confirmation page painted.
export default function CheckoutLoading() {
  return <CheckoutSkeleton />;
}
