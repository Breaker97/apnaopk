"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SellerBankDetails {
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  routingNumber?: string;
  swiftCode?: string;
}

/**
 * Where a seller's payout is sent. Payouts are paid by hand, so the admin
 * needs the account in front of them — on the payout, not three screens away
 * in the seller's settings. The account number stays masked until asked for.
 */
export function SellerBankDetailsBlock({ details }: { details?: SellerBankDetails | null }) {
  const t = useTranslations("admin.payoutsPage.sendTo");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const hasAccount = Boolean(details?.accountName?.trim() && details?.accountNumber?.trim());

  if (!hasAccount) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-sm">
        <p className="font-medium">{t("title")}</p>
        <p className="text-muted-foreground">{t("missing")}</p>
      </div>
    );
  }

  const number = details!.accountNumber!.trim();
  const masked = number.length > 4 ? `•••• ${number.slice(-4)}` : number;
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      // Clipboard refused (an insecure origin): the value is on screen to copy by hand.
    }
  };
  const rows: Array<{ key: string; label: string; value?: string; secret?: boolean }> = [
    { key: "accountName", label: t("accountName"), value: details?.accountName },
    { key: "accountNumber", label: t("accountNumber"), value: number, secret: true },
    { key: "bankName", label: t("bankName"), value: details?.bankName },
    { key: "routingNumber", label: t("routingNumber"), value: details?.routingNumber },
    { key: "swiftCode", label: t("swiftCode"), value: details?.swiftCode },
  ];

  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="mb-2 font-medium">{t("title")}</p>
      <dl className="space-y-1.5">
        {rows
          .filter((row) => row.value?.trim())
          .map((row) => (
            <div key={row.key} className="flex min-w-0 items-center justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono tabular-nums">
                  {row.secret && !revealed ? masked : row.value}
                </span>
                {row.secret && !revealed ? (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t("show")} onClick={() => setRevealed(true)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t("copy", { field: row.label })} onClick={() => void copy(row.key, row.value!.trim())}>
                    {copied === row.key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
