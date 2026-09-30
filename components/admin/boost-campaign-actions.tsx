"use client";

import { useCallback, useState } from "react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import { Ban, Pause, Play, Receipt } from "lucide-react";
import type { DataTableAction } from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { formatCurrency } from "@/lib/intl/money";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";

const BOOST_CAMPAIGN_API = "/api/admin/boosts/campaigns";

type BoostCampaignAction =
  | "pause"
  | "resume"
  | "cancel"
  | "mark_refunded";

/** Statuses a booking can still be cancelled out of. */
const CANCELLABLE = ["scheduled", "active", "paused", "pending_payment"];

/**
 * The four admin verbs, in one place.
 *
 * The list and the booking screen offer the same actions with the same
 * warnings: pause hands the remaining days straight back to the calendar, and
 * an admin who learns that on one screen and not the other finds a rung resold
 * either way.
 */
export function useBoostCampaignActions() {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [actioningId, setActioningId] = useState<string | null>(null);

  const runAction = useCallback(
    async (
      row: Pick<
        BoostCampaignListRow,
        "_id" | "refundableAmount" | "currency"
      >,
      action: BoostCampaignAction,
    ) => {
      if (action === "cancel") {
        const confirmed = await confirm({
          title: label("boosts.admin.cancelTitle", "Cancel booking"),
          description: label(
            "boosts.admin.cancelDescription",
            // Materially different from the flat-fee model: the days are
            // inventory, and they go straight back on sale. An admin who
            // cancels expecting a reversible pause would find the rung resold.
            "Every booked day from tomorrow onward is released back to the calendar immediately and can be resold. Days already run stay billed; anything released is added to the vendor's credit for you to refund at the gateway.",
          ),
          confirmText: label("common.confirm", "Confirm"),
          cancelText: label("common.cancel", "Cancel"),
          variant: "destructive",
        });
        if (!confirmed) return;
      }
      if (action === "mark_refunded") {
        const confirmed = await confirm({
          title: label("boosts.admin.markRefundedTitle", "Mark as refunded"),
          // Naming the figure is the point: this writes money into the ledger
          // and the admin has to recognise the amount they just sent.
          description: `${formatCurrency(row.refundableAmount, row.currency)} — ${label(
            "boosts.admin.markRefundedDescription",
            "Records that you have already refunded the outstanding credit at the payment provider. This only updates the ledger — it does not move any money.",
          )}`,
          confirmText: label("common.confirm", "Confirm"),
          cancelText: label("common.cancel", "Cancel"),
        });
        if (!confirmed) return;
      }
      setActioningId(row._id);
      try {
        await apiClient.patch(`${BOOST_CAMPAIGN_API}/${row._id}`, { action });
        toast.success(label("boosts.admin.updated", "Campaign updated"));
        router.refresh();
      } catch (error) {
        // A resume can lose the days it is trying to take back; the route
        // answers with them, and the admin has to tell the vendor which.
        const days =
          error instanceof ApiClientError
            ? ((error.details as { conflictDays?: string[] } | undefined)
                ?.conflictDays ?? [])
            : [];
        toast.error(
          days.length > 0
            ? `${error instanceof Error ? error.message : ""}`.trim() ||
                days.join(", ")
            : error instanceof Error
              ? error.message
              : label("boosts.admin.updateFailed", "Failed to update campaign"),
        );
      } finally {
        setActioningId(null);
      }
    },
    [confirm, label, router],
  );

  /** Which verbs a row is actually in a state to accept. */
  const buildActions = useCallback(
    (row: BoostCampaignListRow): DataTableAction[] => {
      const actions: DataTableAction[] = [];
      const busy = actioningId === row._id;

      // Pause is an ACTIVE-only verb: a scheduled booking has nothing to stop,
      // and pausing it would release days the vendor has already paid for.
      if (row.status === "active") {
        actions.push({
          id: "pause",
          label: label("boosts.admin.pause", "Pause"),
          icon: <Pause className="h-4 w-4" />,
          onClick: () => runAction(row, "pause"),
          disabled: busy,
        });
      }
      if (row.status === "paused") {
        actions.push({
          id: "resume",
          label: label("boosts.admin.resume", "Resume"),
          icon: <Play className="h-4 w-4" />,
          onClick: () => runAction(row, "resume"),
          disabled: busy,
        });
      }
      // The only path that clears an outstanding obligation. For a manual
      // booking it is the ONLY path — there is no gateway webhook behind it.
      if (row.refundableAmount > 0) {
        actions.push({
          id: "mark-refunded",
          label: label("boosts.admin.markRefunded", "Mark refunded"),
          icon: <Receipt className="h-4 w-4" />,
          hint: formatCurrency(row.refundableAmount, row.currency),
          onClick: () => runAction(row, "mark_refunded"),
          disabled: busy,
        });
      }
      if (CANCELLABLE.includes(row.status)) {
        actions.push({
          id: "cancel",
          label: label("boosts.admin.cancel", "Cancel"),
          icon: <Ban className="h-4 w-4 text-destructive" />,
          onClick: () => runAction(row, "cancel"),
          variant: "destructive",
          disabled: busy,
        });
      }
      return actions;
    },
    [actioningId, label, runAction],
  );

  return { actioningId, runAction, buildActions };
}
