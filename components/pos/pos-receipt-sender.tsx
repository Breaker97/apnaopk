"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface POSReceiptSenderProps {
  /** The sale's server id; null for a sale queued offline. */
  orderId: string | null;
  defaultEmail?: string;
  defaultPhone?: string;
  /** Which ways this store can send a receipt (`lib/pos/pos-seat-settings.ts`). */
  receiptChannels?: { email: boolean; sms: boolean };
}

type Channel = "email" | "sms";

/**
 * "Email receipt" / "Text receipt", with the sale's customer prefilled.
 *
 * Used on the sale-complete screen and on a past sale found again. Renders
 * nothing when the store has neither email nor texts set up; says so, and
 * offers nothing, for a sale still queued offline.
 */
export function POSReceiptSender({
  orderId,
  defaultEmail,
  defaultPhone,
  receiptChannels,
}: POSReceiptSenderProps) {
  const t = useTranslations("pos.complete");
  const [channel, setChannel] = React.useState<Channel | null>(null);
  const [recipient, setRecipient] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);

  // Another sale starts with the form closed.
  useApplyOnChange([orderId], () => {
    setChannel(null);
    setRecipient("");
  });

  const canEmail = Boolean(receiptChannels?.email);
  const canText = Boolean(receiptChannels?.sms);
  if (!canEmail && !canText) return null;
  if (!orderId) return <p className="text-xs text-muted-foreground">{t("offlineHint")}</p>;

  const start = (next: Channel) => {
    setChannel(next);
    setRecipient((next === "email" ? defaultEmail : defaultPhone) ?? "");
  };

  const send = async () => {
    if (!channel || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/pos/orders/${encodeURIComponent(orderId)}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, to: recipient.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast.error(json?.message || t("sendFailed"));
        return;
      }
      const to = String(json.data?.to ?? recipient);
      if (json.data?.status === "duplicate") {
        toast.info(t("alreadySent", { to }));
      } else {
        toast.success(channel === "email" ? t("sentEmail", { to }) : t("sentSms", { to }));
      }
      setChannel(null);
    } catch {
      toast.error(t("sendFailed"));
    } finally {
      setIsSending(false);
    }
  };

  if (channel) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Input
          autoFocus
          type={channel === "email" ? "email" : "tel"}
          inputMode={channel === "email" ? "email" : "tel"}
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder={channel === "email" ? t("emailPlaceholder") : t("phonePlaceholder")}
          aria-label={channel === "email" ? t("emailReceipt") : t("textReceipt")}
          className="h-10 flex-1 rounded-xl"
        />
        <Button type="submit" disabled={isSending || !recipient.trim()} className="h-10 rounded-xl">
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="sr-only sm:not-sr-only sm:ml-1.5">{t("send")}</span>
        </Button>
        <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={() => setChannel(null)}>
          {t("cancel")}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {canEmail ? (
        <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => start("email")}>
          <Mail className="mr-1.5 h-4 w-4" />
          {t("emailReceipt")}
        </Button>
      ) : null}
      {canText ? (
        <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => start("sms")}>
          <MessageSquare className="mr-1.5 h-4 w-4" />
          {t("textReceipt")}
        </Button>
      ) : null}
    </div>
  );
}
