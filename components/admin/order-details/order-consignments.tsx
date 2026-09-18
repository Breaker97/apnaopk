"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PackageX, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputDialog, type InputDialogValues } from "@/components/ui/input-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import type { IOrder } from "@/types";

type ConsignmentOrder = IOrder & {
  /** Seller store names by vendor id, resolved by the page loader. */
  consignmentSellers?: Record<string, string>;
  /** Chargebacks standing on the order, and the sellers each falls on. */
  chargebacks?: Array<{
    _id: string;
    amount: number;
    disputeId?: string;
    vendorIds: string[];
  }>;
};

interface OrderConsignmentsProps {
  order: ConsignmentOrder;
  /** Cancelling refunds the consignment's share, so it needs refund authority. */
  canCancel: boolean;
  /** Only an admin may cancel a consignment that has already shipped. */
  canOverride: boolean;
}

const DISPATCHED = new Set(["shipped", "delivered"]);

type CancelResult = {
  orderStatus: string;
  refund?: { refunded: boolean; amount?: number; currency?: string; reason?: string };
};

/**
 * Each seller's part of a split order, and the one control the store had no
 * way to reach: cancelling a single seller's consignment without cancelling
 * everyone else's. Shown only when there is more than one consignment.
 */
export function OrderConsignments({ order, canCancel, canOverride }: OrderConsignmentsProps) {
  const t = useTranslations("admin");
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const [target, setTarget] = useState<{ id: string; seller: string; dispatched: boolean } | null>(null);
  const [values, setValues] = useState<InputDialogValues>({ reason: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const { confirm } = useConfirmation();

  const subOrders = order.subOrders || [];
  if (subOrders.length < 2) return null;

  const liveCount = subOrders.filter((sub) => sub.status !== "cancelled").length;

  const sellerName = (vendorId: string, index: number) =>
    order.consignmentSellers?.[vendorId] ||
    t("orderDetails.consignmentSellerFallback", { number: index + 1 });

  /** Put one chargeback on one seller's consignment. */
  const attribute = async (chargeback: { _id: string; amount: number }, subOrderId: string) => {
    const index = subOrders.findIndex((sub) => String(sub._id) === subOrderId);
    const sub = subOrders[index];
    if (!sub) return;
    const seller = sellerName(String(sub.vendorId), index);
    const agreed = await confirm({
      type: "warning",
      title: t("orderDetails.chargebackAttributeTitle", { seller }),
      description: t("orderDetails.chargebackAttributeDescription", {
        amount: formatPrice(chargeback.amount),
        seller,
      }),
      confirmText: t("orderDetails.chargebackAttributeConfirm"),
      cancelText: t("orderDetails.cancel"),
    });
    if (!agreed) return;
    setMoving(chargeback._id);
    try {
      await apiClient.post(
        `/api/admin/orders/${order._id}/chargebacks/${chargeback._id}/attribute`,
        { subOrderIds: [subOrderId] },
      );
      toast.success(
        t("orderDetails.chargebackAttributed", {
          amount: formatPrice(chargeback.amount),
          seller,
        }),
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("orderDetails.chargebackAttributeFailed"),
      );
    } finally {
      setMoving(null);
    }
  };

  const submit = async (submitted: InputDialogValues) => {
    if (!target) return;
    const reason = (submitted.reason || "").trim();
    if (reason.length < 3) {
      setErrors({ reason: t("orderDetails.consignmentCancelReasonRequired") });
      return;
    }
    setSaving(true);
    try {
      const result = await apiClient.post<CancelResult>(
        `/api/admin/orders/${order._id}/consignments/${target.id}/cancel`,
        { reason, ...(target.dispatched ? { override: true } : {}) },
      );
      const refund = result?.refund;
      if (refund?.refunded && refund.amount) {
        toast.success(
          t("orderDetails.consignmentCancelledRefunded", {
            seller: target.seller,
            amount: formatPrice(refund.amount),
          }),
        );
      } else if (refund && !refund.refunded && refund.reason) {
        toast.warning(
          t("orderDetails.consignmentCancelledNoRefund", {
            seller: target.seller,
            reason: refund.reason,
          }),
        );
      } else {
        toast.success(t("orderDetails.consignmentCancelled", { seller: target.seller }));
      }
      setTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("orderDetails.consignmentCancelFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="gap-4 p-0">
      <CardHeader className="pt-6">
        <CardTitle>{t("orderDetails.consignments")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {subOrders.map((sub, index) => {
            const id = String(sub._id || index);
            const seller =
              order.consignmentSellers?.[String(sub.vendorId)] ||
              t("orderDetails.consignmentSellerFallback", { number: index + 1 });
            const status = String(sub.status || "pending");
            const dispatched = DISPATCHED.has(status);
            const cancellable =
              canCancel &&
              status !== "cancelled" &&
              order.status !== "cancelled" &&
              liveCount > 1 &&
              (!dispatched || canOverride);
            const units = (sub.items || []).reduce(
              (sum, item) => sum + Number(item.quantity || 0),
              0,
            );

            return (
              <li
                key={id}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{seller}</span>
                    <Badge
                      variant={status === "cancelled" ? "destructive" : "outline"}
                      className="capitalize"
                    >
                      {status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("orderDetails.consignmentSummary", {
                      units,
                      subtotal: formatPrice(Number(sub.subtotal || 0)),
                    })}
                  </p>
                </div>
                {cancellable ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      setValues({ reason: "" });
                      setErrors({});
                      setTarget({ id: String(sub._id), seller, dispatched });
                    }}
                  >
                    <PackageX className="mr-2 h-4 w-4" />
                    {dispatched
                      ? t("orderDetails.consignmentCancelOverride")
                      : t("orderDetails.consignmentCancel")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {(order.chargebacks || []).length > 0 ? (
          <div className="border-t px-6 py-4">
            <p className="text-sm font-medium">{t("orderDetails.chargebacks")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("orderDetails.chargebacksHint")}
            </p>
            <ul className="mt-3 space-y-3">
              {(order.chargebacks || []).map((chargeback) => {
                const onSellers = chargeback.vendorIds
                  .map((vendorId) =>
                    sellerName(
                      vendorId,
                      subOrders.findIndex((sub) => String(sub.vendorId) === vendorId),
                    ),
                  )
                  .join(", ");
                return (
                  <li
                    key={chargeback._id}
                    className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2"
                  >
                    <div className="min-w-0 text-sm">
                      <span className="font-medium tabular-nums">
                        {formatPrice(chargeback.amount)}
                      </span>
                      {chargeback.disputeId ? (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {chargeback.disputeId}
                        </span>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {onSellers
                          ? t("orderDetails.chargebackFallsOn", { sellers: onSellers })
                          : t("orderDetails.chargebackFallsOnAll")}
                      </p>
                    </div>
                    {canCancel ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Scale className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only sm:not-sr-only">
                          {t("orderDetails.chargebackAttribute")}
                        </span>
                        <NativeSelect
                          size="sm"
                          value=""
                          disabled={moving === chargeback._id}
                          aria-label={t("orderDetails.chargebackAttribute")}
                          onChange={(event) => {
                            if (event.target.value) {
                              void attribute(chargeback, event.target.value);
                            }
                          }}
                        >
                          <option value="">{t("orderDetails.chargebackChooseSeller")}</option>
                          {subOrders.map((sub, index) => (
                            <option key={String(sub._id)} value={String(sub._id)}>
                              {sellerName(String(sub.vendorId), index)}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <InputDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={t("orderDetails.consignmentCancelTitle", { seller: target?.seller || "" })}
        description={
          target?.dispatched
            ? t("orderDetails.consignmentCancelDispatchedDescription")
            : t("orderDetails.consignmentCancelDescription")
        }
        fields={[
          {
            name: "reason",
            label: t("orderDetails.consignmentCancelReason"),
            multiline: true,
            rows: 3,
            required: true,
          },
        ]}
        values={values}
        onValuesChange={(next) => {
          setValues(next);
          if (Object.keys(errors).length > 0) setErrors({});
        }}
        onSubmit={submit}
        submitText={t("orderDetails.consignmentCancelConfirm")}
        cancelText={t("orderDetails.cancel")}
        submitVariant="destructive"
        loading={saving}
        errors={errors}
      />
    </Card>
  );
}
