"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";

export type FinanceOutcome = { operationId?: string; bookkeepingState?: "pending" | "complete" };
export function useFinanceRequest() {
  const pendingKeys = useRef(new Map<string, string>());
  const t = useTranslations("finance.reliability");
  const key = (scope: string, payload: unknown) => {
    const fingerprint = `${scope}:${JSON.stringify(payload)}`;
    let value = pendingKeys.current.get(fingerprint);
    if (!value) { value = crypto.randomUUID(); pendingKeys.current.set(fingerprint, value); }
    return value;
  };
  const completed = (outcome: FinanceOutcome, message: string) => {
    pendingKeys.current.clear();
    if (outcome.bookkeepingState !== "pending") { toast.success(message); return; }
    toast.info(t("pending"), { description: outcome.operationId, duration: 15_000, action: outcome.operationId ? {
      label: t("checkStatus"), onClick: () => {
        apiClient.get<{ state: string }>(`/api/admin/finance/operations/${outcome.operationId}`).then((status) => {
          if (status.state === "complete") toast.success(t("completed"));
          else toast.info(t("pending"), { description: outcome.operationId });
        }).catch((error) => toast.error(error instanceof Error ? error.message : t("readError")));
      },
    } : undefined });
  };
  return { key, completed };
}
