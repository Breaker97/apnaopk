"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";
import {
  formatPreorderAccessDate,
  usePreorderAccessDecision,
} from "./use-preorder-access-decision";

interface PreorderAccessState {
  policy: {
    enabled: boolean;
    requireVendorApproval: boolean;
    maxLeadDays: number;
    maxDepositPercent: number;
  };
  preorder: {
    enabled?: boolean;
    requestedAt?: string | null;
    approvedAt?: string | null;
    note?: string | null;
  } | null;
}

/**
 * Vendor → Access → Pre-order access.
 *
 * The queue in Marketplace settings lists only vendors who asked, so an admin
 * had no way to grant access to one who had not — or to see where a single
 * vendor stood without reading a store-wide list. Decisions go through the
 * same route and hook as the queue, so the vendor is told either way.
 */
export function VendorPreorderAccessCard({
  vendorId,
  storeName,
  readOnly,
}: {
  vendorId: string;
  storeName?: string;
  readOnly?: boolean;
}) {
  const t = useTranslations("admin.preorderAccess");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [state, setState] = useState<PreorderAccessState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // State is set only in the request's callbacks, never in the effect body, so
  // mounting does not render a second time before the answer is in.
  const load = useCallback(
    () =>
      apiClient
        .get<PreorderAccessState>(`/api/admin/vendors/${vendorId}/preorder`)
        .then(
          (result) => {
            setState(result);
            setLoadFailed(false);
          },
          () => setLoadFailed(true),
        ),
    [vendorId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const { busyVendorId, approve, refuse, dialog } =
    usePreorderAccessDecision(load);
  const vendor = { _id: vendorId, storeName };
  const busy = busyVendorId === vendorId;

  const hasAccess = Boolean(state?.preorder?.enabled);
  const requestedAt = hasAccess ? null : state?.preorder?.requestedAt || null;
  const note = state?.preorder?.note?.trim();
  const approvedOn = formatPreorderAccessDate(state?.preorder?.approvedAt, locale);
  const askedOn = formatPreorderAccessDate(requestedAt, locale);
  const statusLine = hasAccess
    ? t("since", { date: approvedOn || "—" })
    : requestedAt
      ? askedOn
        ? t("asked", { date: askedOn })
        : t("askedRecently")
      : t("notAsked");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{t("card.title")}</CardTitle>
            <CardDescription className="max-w-3xl text-pretty">
              {t("card.description")}
            </CardDescription>
          </div>
          <Link
            href="/admin/settings/marketplace#preorder-access"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            {t("card.rulesLink")}
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!state ? (
          loadFailed ? (
            <p className="text-muted-foreground text-sm">
              {t("card.loadFailed")}{" "}
              <button
                type="button"
                className="text-foreground underline underline-offset-2"
                onClick={() => void load()}
              >
                {tCommon("tryAgain")}
              </button>
            </p>
          ) : (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )
        ) : (
          <>
            {!state.policy.enabled ? (
              <p className="text-muted-foreground text-sm">
                {t("card.storeOff")}
              </p>
            ) : !state.policy.requireVendorApproval ? (
              <p className="text-muted-foreground text-sm">
                {t("card.reviewOff")}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {hasAccess ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    >
                      {t("approvedBadge")}
                    </Badge>
                  ) : requestedAt ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-400"
                    >
                      {t("waitingBadge")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      {t("noAccessBadge")}
                    </Badge>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {statusLine}
                  </span>
                </div>
                {note ? (
                  <p className="text-muted-foreground text-xs break-words">
                    {t("lastNote", { note })}
                  </p>
                ) : null}
              </div>

              {!readOnly ? (
                <div className="flex flex-wrap gap-2">
                  {hasAccess ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => refuse(vendor, "revoke")}
                    >
                      {t("revokeSubmit")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => approve(vendor)}
                      >
                        {requestedAt ? t("approve") : t("grant")}
                      </Button>
                      {requestedAt ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => refuse(vendor, "decline")}
                        >
                          {t("declineSubmit")}
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            <p className="text-muted-foreground text-xs">
              {t("card.limits", {
                days: state.policy.maxLeadDays,
                percent: state.policy.maxDepositPercent,
              })}
            </p>
          </>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}
