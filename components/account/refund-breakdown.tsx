"use client";

/**
 * The refund, line by line.
 *
 * A single "Estimated refund: X" told a shopper the answer and none of the
 * working, which is exactly what a return dispute is an argument about. Every
 * part of the figure is already stored on the request — this renders it.
 *
 * Used in two places on purpose: the return dialog quotes it from the preview
 * BEFORE anything is submitted, and the request list shows the stored estimate
 * afterwards. Same component, so the shopper sees the same shape both times.
 */

import { cn } from "@/lib/utils";

export interface RefundBreakdownData {
  itemsSubtotal: number;
  shipping: number;
  tax: number;
  discountAdjustment: number;
  restockingFee: number;
  returnShippingFee: number;
  total: number;
  currency?: string;
}

interface RefundBreakdownProps {
  estimate: RefundBreakdownData;
  formatPrice: (value: number) => string;
  /**
   * Whether the store hands the original delivery back for this return. Known
   * while previewing; absent for a stored estimate, where a zero delivery is
   * simply left out rather than explained.
   */
  refundsShipping?: boolean;
  /** Whether the return is the store's fault, which waives both fees. */
  merchantAtFault?: boolean;
  className?: string;
}

const isPositive = (value: unknown) => Number(value || 0) > 0;

export function RefundBreakdown({
  estimate,
  formatPrice,
  refundsShipping,
  merchantAtFault,
  className,
}: RefundBreakdownProps) {
  const rows: Array<{ label: string; value: number; negative?: boolean }> = [
    { label: "Items", value: Number(estimate.itemsSubtotal || 0) },
  ];

  if (isPositive(estimate.discountAdjustment)) {
    rows.push({
      label: "Discount applied at checkout",
      value: Number(estimate.discountAdjustment),
      negative: true,
    });
  }
  if (isPositive(estimate.tax)) {
    rows.push({ label: "Tax", value: Number(estimate.tax) });
  }
  if (isPositive(estimate.shipping)) {
    rows.push({ label: "Delivery charge", value: Number(estimate.shipping) });
  }
  if (isPositive(estimate.restockingFee)) {
    rows.push({
      label: "Restocking fee",
      value: Number(estimate.restockingFee),
      negative: true,
    });
  }
  if (isPositive(estimate.returnShippingFee)) {
    rows.push({
      label: "Return shipping",
      value: Number(estimate.returnShippingFee),
      negative: true,
    });
  }

  // Only while previewing, where we know the policy answered "no" rather than
  // the order simply having had free delivery. Saying nothing here is what let
  // a shopper expect the delivery back and find it missing.
  const showsUnrefundedDelivery =
    refundsShipping === false && !isPositive(estimate.shipping);

  return (
    <div className={cn("rounded-md border bg-muted/40 p-4 text-sm", className)}>
      <dl className="grid gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">
              {row.negative ? "−" : ""}
              {formatPrice(row.value)}
            </dd>
          </div>
        ))}

        {showsUnrefundedDelivery ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Delivery charge</dt>
            <dd className="text-muted-foreground">Not refunded</dd>
          </div>
        ) : null}

        <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-3">
          <dt className="font-medium">Estimated refund</dt>
          <dd className="font-medium tabular-nums">
            {formatPrice(Number(estimate.total || 0))}
          </dd>
        </div>
      </dl>

      {merchantAtFault ? (
        <p className="mt-3 text-xs text-muted-foreground">
          This return is on us, so there is no restocking or return shipping fee.
        </p>
      ) : null}
    </div>
  );
}
