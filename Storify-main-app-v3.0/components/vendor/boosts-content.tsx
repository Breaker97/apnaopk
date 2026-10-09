"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import { Ban } from "lucide-react";
import type { DataTableAction } from "@/components/ui/data-table";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { RAZORPAY_RETURN_PARAM } from "@/lib/payments/razorpay-callback";
import { BoostCampaignsTable } from "@/components/admin/boost-campaigns-table";
import { BoostPurchaseDialog } from "@/components/vendor/boost-purchase-dialog";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Vendor boosts list. Verifies a returning `?boost_payment=` redirect once
 * on mount (so the vendor sees the campaign flip to Active even before the
 * webhook lands), then strips the param from the URL.
 */
export function BoostsContent(props: {
  locale: string;
  data: BoostCampaignListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const label = useFallbackTranslator(t);

  const { confirm } = useConfirmation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const verifiedRef = useRef(false);

  /**
   * Withdraw a booking that has not started yet.
   *
   * Deliberately absent on an `active` booking: part of it has already
   * rendered, and self-service on a mid-flight placement turns every
   * disappointing day into a refund dispute. The reason it exists at all is
   * that bookings run up to 60 days out — "email support to cancel" leaves the
   * marketplace sitting on inventory it cannot resell until a human intervenes.
   */
  const cancelBooking = useCallback(
    async (row: BoostCampaignListRow) => {
      const ok = await confirm({
        title: label("boosts.cancel.title", "Cancel this booking?"),
        description: label(
          "boosts.cancel.description",
          "The days go back on sale immediately and someone else can book them. Anything you have paid is credited back to you and refunded through your payment provider.",
        ),
        confirmText: label("boosts.cancel.confirm", "Cancel booking"),
        cancelText: label("common.back", "Back"),
        type: "danger",
      });
      if (!ok) return;
      setCancelingId(row._id);
      try {
        await apiClient.delete(`/api/vendor/boosts/campaigns/${row._id}`);
        toast.success(label("boosts.cancel.done", "Booking canceled"));
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : label("boosts.cancel.failed", "Could not cancel the booking"),
        );
      } finally {
        setCancelingId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, router, t],
  );

  const rowActions = useCallback(
    (row: BoostCampaignListRow): DataTableAction[] =>
      row.status === "scheduled"
        ? [
            {
              id: "cancel",
              label: label("boosts.cancel.action", "Cancel booking"),
              icon: <Ban className="h-4 w-4 text-destructive" />,
              onClick: () => cancelBooking(row),
              variant: "destructive",
              disabled: cancelingId === row._id,
            },
          ]
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cancelBooking, cancelingId, t],
  );

  // Return-from-gateway verification (once).
  useEffect(() => {
    const paymentId = searchParams.get("boost_payment");
    const canceled = searchParams.get("canceled");
    if (!paymentId || verifiedRef.current) return;
    verifiedRef.current = true;

    const cleanUrl = () => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("boost_payment");
      params.delete("canceled");
      params.delete("session_id");
      params.delete("reference");
      params.delete("trxref");
      params.delete("OrderTrackingId");
      params.delete("OrderMerchantReference");
      for (const key of Object.values(RAZORPAY_RETURN_PARAM)) {
        params.delete(key);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    };

    if (canceled) {
      toast.info(
        label("boosts.purchase.canceled", "Payment was canceled. Please try again."),
      );
      cleanUrl();
      return;
    }

    apiClient
      .post<{ paid: boolean }>("/api/vendor/boosts/checkout/verify", {
        paymentId,
        // A Razorpay return carries the signed payment; the route cannot ask
        // Razorpay about this attempt without it.
        razorpayPaymentId:
          searchParams.get(RAZORPAY_RETURN_PARAM.paymentId) ?? undefined,
        razorpaySignature:
          searchParams.get(RAZORPAY_RETURN_PARAM.signature) ?? undefined,
      })
      .then(({ paid }) => {
        if (paid) {
          toast.success(
            // Not "your boost is live": a booking that starts next month is
            // paid and correct, and telling that vendor it is live now is the
            // fastest way to get a ticket saying it isn't.
            label("boosts.purchase.booked", "Your booking is confirmed."),
          );
        } else {
          toast.info(
            label(
              "boosts.purchase.pendingInfo",
              "Payment is still processing — the boost activates automatically once confirmed.",
            ),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        cleanUrl();
        router.refresh();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <BoostCampaignsTable
        area="vendor"
        locale={props.locale}
        data={props.data}
        pagination={props.pagination}
        onAdd={() => setDialogOpen(true)}
        rowActions={rowActions}
      />
      <BoostPurchaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locale={props.locale}
      />
    </>
  );
}
