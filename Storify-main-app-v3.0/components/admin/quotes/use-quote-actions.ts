"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { AdminQuoteDetail, AdminQuoteRow } from "@/lib/quotes/quotes";
import { quoteApiPath, type QuoteScope } from "./quote-ui";

type QuoteLike = Pick<AdminQuoteRow, "_id" | "name" | "productName" | "stage">;

/**
 * The writes a quote row and its detail sheet share: close it as lost, take it
 * back, withdraw its price, delete it. Each asks first where the move is hard
 * to undo, reports how it went, and hands the fresh quote to `onChanged` so
 * the list and the sheet can both redraw from the server's answer.
 *
 * `scope` picks whose routes the writes go to. Deleting is the store's alone,
 * so the vendor's routes have no DELETE for `remove` to reach.
 */
export function useQuoteActions(
  onChanged: (quote: AdminQuoteDetail | null) => void,
  scope: QuoteScope = "admin",
) {
  const t = useTranslations("admin.quotesPage");
  const tc = useTranslations("common");
  const { confirm } = useConfirmation();

  const run = useCallback(
    async (
      request: () => Promise<AdminQuoteDetail | null>,
      success: string,
    ) => {
      try {
        const quote = await request();
        toast.success(success);
        onChanged(quote);
        return true;
      } catch (error) {
        toast.error(
          error instanceof ApiClientError && error.message
            ? error.message
            : t("toast.failed"),
        );
        return false;
      }
    },
    [onChanged, t],
  );

  const markLost = useCallback(
    async (quote: QuoteLike) => {
      const confirmed = await confirm({
        type: "warning",
        title: t("confirm.markLost.title"),
        description:
          quote.stage === "offer_sent"
            ? t("confirm.markLost.descriptionLive")
            : t("confirm.markLost.description"),
        confirmText: t("actions.markLost"),
        cancelText: tc("cancel"),
      });
      if (!confirmed) return false;
      return run(
        () =>
          apiClient.patch<AdminQuoteDetail>(quoteApiPath(scope, quote._id), {
            action: "mark_lost",
          }),
        t("toast.markedLost"),
      );
    },
    [confirm, run, scope, t, tc],
  );

  const reopen = useCallback(
    (quote: QuoteLike) =>
      run(
        () =>
          apiClient.patch<AdminQuoteDetail>(quoteApiPath(scope, quote._id), {
            action: "reopen",
          }),
        t("toast.reopened"),
      ),
    [run, scope, t],
  );

  const withdraw = useCallback(
    async (quote: QuoteLike) => {
      const confirmed = await confirm({
        type: "warning",
        title: t("confirm.withdraw.title"),
        description: t("confirm.withdraw.description", { name: quote.name }),
        confirmText: t("actions.withdraw"),
        cancelText: tc("cancel"),
      });
      if (!confirmed) return false;
      return run(
        () =>
          apiClient.patch<AdminQuoteDetail>(
            quoteApiPath(scope, quote._id, "offer"),
            {},
          ),
        t("toast.withdrawn"),
      );
    },
    [confirm, run, scope, t, tc],
  );

  const remove = useCallback(
    async (quote: QuoteLike) => {
      const confirmed = await confirm({
        type: "danger",
        title: t("confirm.delete.title"),
        description: t("confirm.delete.description", {
          name: quote.name,
          product: quote.productName,
        }),
        confirmText: tc("delete"),
        cancelText: tc("cancel"),
        confirmVariant: "destructive",
      });
      if (!confirmed) return false;
      return run(async () => {
        await apiClient.delete(quoteApiPath("admin", quote._id));
        return null;
      }, t("toast.deleted"));
    },
    [confirm, run, t, tc],
  );

  return { markLost, reopen, withdraw, remove };
}
