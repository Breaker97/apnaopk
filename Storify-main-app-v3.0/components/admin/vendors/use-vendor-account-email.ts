"use client";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient, type ApiClientError } from "@/lib/api/client";
import { toast } from "@/components/ui/toast-notification";
import { accountEmailErrorMessage, describeSkipped, type AccountEmailSkipped } from "@/components/admin/customers/account-email-messages";

export function useVendorAccountEmail(onSent?: () => void) {
  const t = useTranslations("admin.vendorAccountEmail");
  const { confirm } = useConfirmation();
  const [sending, setSending] = useState(false);
  const send = useCallback(async (vendorIds: string[], single = false) => {
    if (sending) return;
    setSending(true);
    try {
      const preview = await apiClient.post<{ sendable: number; skipped: AccountEmailSkipped; emailConfigured: boolean }>(
        "/api/admin/vendors/account-emails/preview", { vendorIds },
      );
      if (!preview.emailConfigured) { toast.error(t("emailNotSetUp")); return; }
      const skipped = describeSkipped(preview.skipped, t);
      if (!preview.sendable) { toast.error([t("nobodyToSend"), skipped].filter(Boolean).join(" ")); return; }
      if (!await confirm({ title: t("confirmBulkTitle"), description: [t("confirmBulkDescription", { count: preview.sendable }), skipped].filter(Boolean).join(" "), confirmText: t("send"), cancelText: t("cancel") })) return;
      if (single) {
        const result = await apiClient.post<{ purpose: "reset" | "invite"; email: string }>(`/api/admin/vendors/${vendorIds[0]}/account-email`);
        toast.success(t(result.purpose === "invite" ? "inviteSent" : "resetSent", { email: result.email }));
      } else {
        const result = await apiClient.post<{ queued: number }>("/api/admin/vendors/account-emails", { vendorIds });
        if (!result.queued) { toast.error(t("nobodyToSend")); return; }
        toast.success(t("queued", { count: result.queued }));
      }
      onSent?.();
    } catch (error) {
      toast.error(accountEmailErrorMessage(error as ApiClientError, t));
    } finally { setSending(false); }
  }, [confirm, onSent, sending, t]);
  return { send, sending, label: t("bulkAction") };
}
