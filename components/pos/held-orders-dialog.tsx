"use client";

import * as React from "react";
import { X, Trash2, Clock, Loader2, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeldOrder } from "@/lib/pos/held-orders";

interface POSHeldOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heldOrders: HeldOrder[];
  onResume: (order: HeldOrder) => void;
  onDelete: (id: string) => void;
  formatPrice: (value: number) => string;
  /** Id of the order currently being re-priced against live stock, if any. */
  resumingId?: string | null;
  /**
   * The counter these holds belong to.
   *
   * Named on the header rather than on each card: holds are keyed by location
   * (`heldOrdersScope`), so every row in this list is from the same counter and
   * a per-card label would repeat the same word down the page. What a cashier
   * needs is the one thing the list cannot otherwise say — that a sale parked at
   * another branch is not in here and is not lost either.
   */
  locationName?: string | null;
}

function itemCount(order: HeldOrder): number {
  return order.cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

function orderSubtotal(order: HeldOrder): number {
  return order.cart.reduce(
    (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
    0,
  );
}

export function POSHeldOrdersDialog({
  open,
  onOpenChange,
  heldOrders,
  onResume,
  onDelete,
  formatPrice,
  resumingId,
  locationName,
}: POSHeldOrdersDialogProps) {
  if (!open) return null;

  const isBusy = Boolean(resumingId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="bg-background w-full max-w-lg rounded-2xl border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-2">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
              Held orders
              {locationName ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  <Store className="h-3 w-3" />
                  {locationName}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {locationName
                ? `Resume a sale parked at ${locationName}. Sales held at another counter stay there.`
                : "Resume a parked sale. Held orders stay on this register."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full -mr-2 -mt-1"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-5 pb-5 pt-3">
          {heldOrders.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No held orders.
            </div>
          ) : (
            <ul className="space-y-2">
              {heldOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => onResume(order)}
                    disabled={isBusy}
                    className="min-w-0 flex-1 text-left disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {order.label || "Untitled hold"}
                      </span>
                      {order.customer ? (
                        <span className="truncate text-xs text-muted-foreground">
                          · {order.customer.name}
                        </span>
                      ) : order.isWalkIn ? (
                        <span className="text-xs text-muted-foreground">
                          · Walk-in
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        {new Date(order.heldAt).toLocaleString()}
                      </span>
                      <span>·</span>
                      <span>
                        {itemCount(order)} item
                        {itemCount(order) === 1 ? "" : "s"}
                      </span>
                      <span>·</span>
                      <span className="font-medium text-foreground">
                        {formatPrice(orderSubtotal(order))}
                      </span>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => onResume(order)}
                      disabled={isBusy}
                      className="rounded-lg"
                    >
                      {resumingId === order.id ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Checking
                        </>
                      ) : (
                        "Resume"
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(order.id)}
                      disabled={isBusy}
                      aria-label="Delete held order"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
