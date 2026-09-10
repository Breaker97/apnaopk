import {
  AdminFormSkeleton,
  type AdminFormSkeletonCard,
} from "@/components/admin/admin-form-skeleton";

/**
 * Placeholder for the create-order form (admin and vendor).
 *
 * Mirrors components/common/order-create-form.tsx as it renders on arrival —
 * an empty draft: sticky header with a Draft badge and Save/Back, a Products
 * card in its empty state, the Payment breakdown, and Notes / Customer / Tags
 * on the side. The Shipping address card is deliberately absent; it only
 * mounts once a customer is picked, so reserving space for it here would drop
 * the real form 300px up the moment it arrives.
 */

const MAIN_CARDS: AdminFormSkeletonCard[] = [
  // Products: "No products added yet" placeholder box.
  { titleWidth: "w-20", blocks: [{ type: "block", height: "h-20" }] },
  // Payment: subtotal / discount / shipping / tax / total, then the
  // "Payment due later" row and the invoice actions.
  {
    titleWidth: "w-20",
    blocks: [
      { type: "table", columns: 3, rows: 5 },
      { type: "block", height: "h-9" },
    ],
  },
];

const SIDE_CARDS: AdminFormSkeletonCard[] = [
  { titleWidth: "w-14", blocks: [{ type: "block", height: "h-14" }] },
  { titleWidth: "w-20", blocks: [{ type: "block", height: "h-9" }] },
  { titleWidth: "w-12", blocks: [{ type: "block", height: "h-14" }] },
];

export function OrderCreateSkeleton() {
  return (
    <AdminFormSkeleton
      mainCards={MAIN_CARDS}
      sideCards={SIDE_CARDS}
      headerActions={2}
      badges={1}
      headerDescription
      spacing="6"
      gridSpacing="4"
    />
  );
}
