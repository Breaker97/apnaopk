import { RouteMessages } from "@/components/language/route-messages";

// Canonical, hreflang and robots from the URL being served.
export { generateMetadata } from "@/lib/storefront/request-path-metadata";

/**
 * Marker layout for the checkout segment (checkout + success).
 *
 * It renders nothing visible — the wrapper's jobs are the
 * `data-checkout-segment` attribute and the checkout and order messages the
 * rest of the storefront does without. Nested layouts flush with the shell,
 * BEFORE the page's data resolves, so the (store) layout's focused-checkout
 * rule (`.store-surface:has([data-checkout-segment]) [data-store-chrome]`)
 * hides the store chrome on the very first paint. Without this marker the
 * hide style only arrived with the page chunk, after the header had already
 * painted — the focused-checkout FOUC.
 */
export default function CheckoutSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-checkout-segment>
      <RouteMessages namespaces={["checkout", "orders"]}>{children}</RouteMessages>
    </div>
  );
}
