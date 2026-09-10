"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { TransferStatusBadge, type TransferStatus } from "@/components/admin/transfers/transfer-status-badge";
import { TransferDetailsSkeleton } from "@/components/admin/transfers/transfer-details-skeleton";
import { apiClient } from "@/lib/api/client";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface TransferItem {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
}

interface TransferRecord {
  _id: string;
  transferNumber: string;
  status: TransferStatus;
  fromLocationName: string;
  toLocationName: string;
  reference?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  items: TransferItem[];
}

const NEXT_ACTIONS: Record<
  TransferStatus,
  Array<{ key: string; status: TransferStatus; variant?: "default" | "outline" | "destructive" }>
> = {
  draft: [
    { key: "markReadyToShip", status: "ready_to_ship", variant: "default" },
    { key: "cancelTransfer", status: "cancelled", variant: "destructive" },
  ],
  ready_to_ship: [
    { key: "markInTransit", status: "in_transit", variant: "default" },
    { key: "cancelTransfer", status: "cancelled", variant: "destructive" },
  ],
  in_transit: [
    { key: "markCompleted", status: "completed", variant: "default" },
    { key: "cancelTransfer", status: "cancelled", variant: "destructive" },
  ],
  completed: [],
  cancelled: [],
};

export function TransferDetails({ locale, transferId }: { locale: string; transferId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [record, setRecord] = useState<TransferRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  /** `silent` re-reads the record without tearing the rendered card down. */
  const load = () =>
    apiClient
      .get<{ transfer: TransferRecord | null }>(
        `/api/admin/transfers/${transferId}`,
      )
      .then((data) => setRecord(data?.transfer || null))
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : t("admin.transfers.details.toasts.loadError"),
        );
        router.push(`/${locale}/admin/transfers`);
      })
      .finally(() => setLoading(false));

  // The first load and a changed id show the skeleton; action reloads do not.
  useApplyOnChange([transferId], () => {
    setLoading(true);
  });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferId]);

  const actions = useMemo(() => {
    if (!record) return [];
    return NEXT_ACTIONS[record.status] || [];
  }, [record]);

  const updateStatus = async (status: TransferStatus) => {
    if (!record) return;
    setUpdating(true);
    try {
      await apiClient.patch(`/api/admin/transfers/${record._id}`, {
        action: "set_status",
        status,
      });
      toast.success(t("admin.transfers.details.toasts.updateSuccess"));
      // The PATCH answers with { transferId } only, so the new status and
      // timestamps still have to be re-read. Keep the card on screen while that
      // lands — the action buttons already carry the in-flight spinner.
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("admin.transfers.details.toasts.updateError"),
      );
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <TransferDetailsSkeleton />;
  }

  if (!record) {
    return null;
  }

  const totalUnits = record.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  return (
    <div className="space-y-4 -mx-2 md:mx-0">
      <div className="flex items-center justify-between">
        <Button variant="outline" asChild>
          <Link href={`/${locale}/admin/transfers`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("admin.transfers.details.backToTransfers")}
          </Link>
        </Button>
        <TransferStatusBadge status={record.status} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-xl">{record.transferNumber}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {t("admin.transfers.details.routeSummary", {
                  from: record.fromLocationName,
                  to: record.toLocationName,
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action.status}
                  variant={action.variant || "default"}
                  disabled={updating}
                  onClick={() => updateStatus(action.status)}
                >
                  {updating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t(`admin.transfers.details.actions.${action.key}`)}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("admin.transfers.details.meta.created")}</p>
              <p className="text-sm font-medium mt-1">{new Date(record.createdAt).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("admin.transfers.details.meta.updated")}</p>
              <p className="text-sm font-medium mt-1">{new Date(record.updatedAt).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("admin.transfers.details.meta.totalUnits")}</p>
              <p className="text-sm font-medium mt-1">{totalUnits}</p>
            </div>
          </div>

          {(record.reference || record.note) && (
            <div className="rounded-lg border p-3 space-y-1">
              {record.reference ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">{t("admin.transfers.details.reference")}:</span> {record.reference}
                </p>
              ) : null}
              {record.note ? (
                <p className="text-sm whitespace-pre-wrap">
                  <span className="text-muted-foreground">{t("admin.transfers.details.note")}:</span> {record.note}
                </p>
              ) : null}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">{t("admin.transfers.details.columns.product")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.transfers.details.columns.variant")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.transfers.details.columns.sku")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.transfers.details.columns.qty")}</th>
                </tr>
              </thead>
              <tbody>
                {record.items.map((item, index) => (
                  <tr key={`${item.productId}-${item.variantId}-${index}`} className="border-t">
                    <td className="px-4 py-3">{item.productTitle}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.variantTitle || t("admin.transfers.details.defaultVariant")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.sku || "-"}</td>
                    <td className="px-4 py-3">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
