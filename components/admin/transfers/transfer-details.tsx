"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { TransferStatusBadge, type TransferStatus } from "@/components/admin/transfers/transfer-status-badge";
import { TransferDetailsSkeleton } from "@/components/admin/transfers/transfer-details-skeleton";
import { TransferReceiveDialog } from "@/components/admin/transfers/transfer-receive-dialog";
import {
  TransferHistory,
  type TransferHistoryEvent,
} from "@/components/admin/transfers/transfer-history";
import { apiClient } from "@/lib/api/client";
import {
  TRANSFER_TABLE_CLASS,
  TRANSFER_TD_CLASS,
  TRANSFER_TH_CLASS,
  transferPaths,
  type TransferArea,
} from "@/components/admin/transfers/transfer-paths";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import {
  hasTransferReceipts,
  isTransferLockStale,
  type TransferAccess,
} from "@/lib/inventory/transfer-rules";

interface TransferItem {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
  receivedQuantity: number;
  rejectedQuantity: number;
  /** Present until the transfer ships. */
  availableAtSource?: number;
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
  shippedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  items: TransferItem[];
  events?: TransferHistoryEvent[];
  stockMovementPending?: boolean;
  stockMovementStartedAt?: string;
}

type StatusAction = "ready_to_ship" | "draft" | "in_transit" | "cancelled";

export function TransferDetails({
  locale,
  transferId,
  area = "admin",
}: {
  locale: string;
  transferId: string;
  area?: TransferArea;
}) {
  const paths = transferPaths(area, locale);
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [record, setRecord] = useState<TransferRecord | null>(null);
  const [access, setAccess] = useState<TransferAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);

  /** `silent` re-reads the record without tearing the rendered card down. */
  const load = () =>
    apiClient
      .get<{ transfer: TransferRecord | null; access: TransferAccess }>(
        `${paths.api}/${transferId}`,
      )
      .then((data) => {
        setRecord(data?.transfer || null);
        setAccess(data?.access || null);
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : t("admin.transfers.details.toasts.loadError"),
        );
        router.push(paths.page);
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

  if (loading) {
    return <TransferDetailsSkeleton />;
  }

  if (!record) {
    return null;
  }

  const totalUnits = record.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const unshipped = record.status === "draft" || record.status === "ready_to_ship";
  const showsProgress = record.status === "in_transit" || record.status === "completed";
  const shortLines = unshipped
    ? record.items.filter(
        (item) => (item.availableAtSource ?? item.quantity) < item.quantity,
      )
    : [];
  const received = hasTransferReceipts(record.items);

  const updateStatus = async (status: StatusAction) => {
    const route = { from: record.fromLocationName, to: record.toLocationName, units: totalUnits };
    const confirmation =
      status === "in_transit"
        ? {
            type: "warning" as const,
            title: t("admin.transfers.details.confirm.shipTitle"),
            description: t("admin.transfers.details.confirm.shipDescription", route),
            confirmText: t("admin.transfers.details.actions.markInTransit"),
          }
        : status === "cancelled"
          ? {
              type: "danger" as const,
              title: t("admin.transfers.details.confirm.cancelTitle"),
              description: t(
                record.status === "in_transit"
                  ? "admin.transfers.details.confirm.cancelInTransitDescription"
                  : "admin.transfers.details.confirm.cancelDescription",
                route,
              ),
              confirmText: t("admin.transfers.details.actions.cancelTransfer"),
              confirmVariant: "destructive" as const,
            }
          : null;

    if (confirmation && !(await confirm(confirmation))) return;

    setUpdating(status);
    try {
      await apiClient.patch(`${paths.api}/${record._id}`, {
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
      setUpdating(null);
    }
  };

  const lockStuck =
    record.stockMovementPending === true &&
    isTransferLockStale(record.stockMovementStartedAt);

  const releaseLock = async () => {
    const ok = await confirm({
      type: "warning",
      title: t("admin.transfers.details.lock.confirmTitle"),
      description: t("admin.transfers.details.lock.confirmDescription", {
        from: record.fromLocationName,
        to: record.toLocationName,
      }),
      confirmText: t("admin.transfers.details.lock.release"),
    });
    if (!ok) return;
    setUpdating("release_lock");
    try {
      await apiClient.patch(`${paths.api}/${record._id}`, { action: "release_lock" });
      toast.success(t("admin.transfers.details.lock.released"));
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("admin.transfers.details.toasts.updateError"),
      );
    } finally {
      setUpdating(null);
    }
  };

  const statusButton = (
    status: StatusAction,
    labelKey: string,
    variant: "default" | "outline" | "destructive" = "default",
  ) => (
    <Button
      key={status}
      variant={variant}
      disabled={updating !== null}
      onClick={() => updateStatus(status)}
    >
      {updating === status ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
      {t(`admin.transfers.details.actions.${labelKey}`)}
    </Button>
  );

  const actions: ReactNode[] = [];
  if (record.status === "draft") {
    if (access?.canEdit) {
      actions.push(
        <Button key="edit" variant="outline" asChild disabled={updating !== null}>
          <Link href={`${paths.page}/${record._id}/edit`}>
            {t("admin.transfers.details.actions.edit")}
          </Link>
        </Button>,
      );
    }
    if (access?.canSend) {
      actions.push(statusButton("cancelled", "cancelTransfer", "destructive"));
      actions.push(statusButton("ready_to_ship", "markReadyToShip"));
    }
  } else if (record.status === "ready_to_ship" && access?.canSend) {
    actions.push(statusButton("cancelled", "cancelTransfer", "destructive"));
    actions.push(statusButton("draft", "returnToDraft", "outline"));
    actions.push(statusButton("in_transit", "markInTransit"));
  } else if (record.status === "in_transit") {
    if (access?.canSend && !received) {
      actions.push(statusButton("cancelled", "cancelTransfer", "destructive"));
    }
    if (access?.canReceive) {
      actions.push(
        <Button key="receive" disabled={updating !== null} onClick={() => setReceiveOpen(true)}>
          {t("admin.transfers.details.actions.receive")}
        </Button>,
      );
    }
  }

  return (
    <div className="space-y-4 -mx-2 md:mx-0">
      <div className="flex items-center justify-between">
        <Button variant="outline" asChild>
          <Link href={paths.page}>
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
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {record.stockMovementPending ? (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  {t(
                    lockStuck
                      ? "admin.transfers.details.lock.stuck"
                      : "admin.transfers.details.lock.busy",
                    { from: record.fromLocationName, to: record.toLocationName },
                  )}
                </p>
              </div>
              {lockStuck && (access?.canSend || access?.canReceive) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={updating !== null}
                  onClick={releaseLock}
                >
                  {updating === "release_lock" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t("admin.transfers.details.lock.release")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {shortLines.length > 0 ? (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                {t("admin.transfers.details.shortage", {
                  lines: shortLines.length,
                  from: record.fromLocationName,
                })}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("admin.transfers.details.meta.created")}</p>
              <p className="text-sm font-medium mt-1">{new Date(record.createdAt).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {t(
                  record.completedAt
                    ? "admin.transfers.details.meta.completed"
                    : record.shippedAt
                      ? "admin.transfers.details.meta.shipped"
                      : "admin.transfers.details.meta.updated",
                )}
              </p>
              <p className="text-sm font-medium mt-1">
                {new Date(record.completedAt || record.shippedAt || record.updatedAt).toLocaleString()}
              </p>
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
            <table className={TRANSFER_TABLE_CLASS}>
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className={TRANSFER_TH_CLASS}>{t("admin.transfers.details.columns.product")}</th>
                  <th className={TRANSFER_TH_CLASS}>{t("admin.transfers.details.columns.variant")}</th>
                  <th className={TRANSFER_TH_CLASS}>{t("admin.transfers.details.columns.sku")}</th>
                  <th className={TRANSFER_TH_CLASS}>{t("admin.transfers.details.columns.qty")}</th>
                  {unshipped ? (
                    <th className={TRANSFER_TH_CLASS}>{t("admin.transfers.details.columns.available")}</th>
                  ) : null}
                  {showsProgress ? (
                    <>
                      <th className={TRANSFER_TH_CLASS}>{t("admin.transfers.details.columns.received")}</th>
                      <th className={TRANSFER_TH_CLASS}>{t("admin.transfers.details.columns.rejected")}</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {record.items.map((item, index) => {
                  const short = (item.availableAtSource ?? item.quantity) < item.quantity;
                  return (
                    <tr key={`${item.productId}-${item.variantId}-${index}`} className="border-t">
                      <td className={TRANSFER_TD_CLASS}>{item.productTitle}</td>
                      <td className={`${TRANSFER_TD_CLASS} text-muted-foreground`}>
                        {item.variantId
                          ? item.variantTitle || t("admin.transfers.details.defaultVariant")
                          : "-"}
                      </td>
                      <td className={`${TRANSFER_TD_CLASS} font-mono`}>{item.sku || "-"}</td>
                      <td className={TRANSFER_TD_CLASS}>{item.quantity}</td>
                      {unshipped ? (
                        <td className={short ? `${TRANSFER_TD_CLASS} font-medium text-destructive` : TRANSFER_TD_CLASS}>
                          {item.availableAtSource ?? "-"}
                        </td>
                      ) : null}
                      {showsProgress ? (
                        <>
                          <td className={TRANSFER_TD_CLASS}>{item.receivedQuantity}</td>
                          <td className={item.rejectedQuantity > 0 ? `${TRANSFER_TD_CLASS} text-destructive` : TRANSFER_TD_CLASS}>
                            {item.rejectedQuantity}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <TransferHistory record={record} />

      {receiveOpen ? (
        <TransferReceiveDialog
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          transferId={record._id}
          apiBase={paths.api}
          destinationName={record.toLocationName}
          items={record.items}
          onReceived={(completed) => {
            toast.success(
              t(
                completed
                  ? "admin.transfers.receive.completed"
                  : "admin.transfers.receive.success",
              ),
            );
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
