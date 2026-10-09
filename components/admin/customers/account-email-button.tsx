"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2, MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { accountEmailErrorMessage } from "./account-email-messages";

export type AccountEmailKind = "reset" | "invite";

interface AccountEmailButtonProps {
  /** The customer profile's id, as in the page's URL. */
  customerId: string;
  /** From the customer's GET: what the account can be sent. */
  kind: AccountEmailKind;
  email: string;
}

/**
 * The customer page's "Send password reset" — or, for an account with no
 * password (a guest's included), "Send account invite". One email, sent while
 * the admin waits, so a failure is said here rather than in a log.
 */
export function AccountEmailButton({ customerId, kind, email }: AccountEmailButtonProps) {
  const t = useTranslations("admin.customerAccountEmail");
  const { confirm } = useConfirmation();
  const [sending, setSending] = useState(false);
  const invite = kind === "invite";

  const send = useCallback(async () => {
    const confirmed = await confirm({
      title: invite ? t("confirmInviteTitle") : t("confirmResetTitle"),
      description: invite
        ? t("confirmInviteDescription", { email })
        : t("confirmResetDescription", { email }),
      confirmText: t("send"),
      cancelText: t("cancel"),
    });
    if (!confirmed) return;

    setSending(true);
    try {
      const result = await apiClient.post<{ purpose: AccountEmailKind; email: string }>(
        `/api/admin/customers/${customerId}/account-email`,
      );
      toast.success(
        result.purpose === "invite"
          ? t("inviteSent", { email: result.email })
          : t("resetSent", { email: result.email }),
      );
    } catch (error) {
      toast.error(accountEmailErrorMessage(error as ApiClientError, t));
    } finally {
      setSending(false);
    }
  }, [confirm, customerId, email, invite, t]);

  const Icon = invite ? MailPlus : KeyRound;
  return (
    <Button type="button" variant="outline" size="sm" onClick={send} disabled={sending}>
      {sending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Icon className="mr-2 h-4 w-4" />
      )}
      {invite ? t("sendInvite") : t("sendReset")}
    </Button>
  );
}
