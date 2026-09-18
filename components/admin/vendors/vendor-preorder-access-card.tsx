"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  locale,
  readOnly,
}: {
  vendorId: string;
  storeName?: string;
  locale: string;
  readOnly?: boolean;
}) {
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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Pre-order access</CardTitle>
            <CardDescription className="max-w-3xl text-pretty">
              Whether this vendor may open pre-orders. A pre-order takes a
              shopper&apos;s money before the goods exist, so the store can
              review who is allowed to.
            </CardDescription>
          </div>
          <Link
            href={`/${locale}/admin/settings/marketplace#preorder-access`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            Pre-order rules
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!state ? (
          loadFailed ? (
            <p className="text-muted-foreground text-sm">
              Could not load pre-order access.{" "}
              <button
                type="button"
                className="text-foreground underline underline-offset-2"
                onClick={() => void load()}
              >
                Try again
              </button>
            </p>
          ) : (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )
        ) : (
          <>
            {!state.policy.enabled ? (
              <p className="text-muted-foreground text-sm">
                Pre-orders are switched off for the whole store, so nobody can
                open one right now. What you set here applies once they are
                back on, and the vendor is not notified of it.
              </p>
            ) : !state.policy.requireVendorApproval ? (
              <p className="text-muted-foreground text-sm">
                Review is off, so this vendor can already open pre-orders. What
                you set here applies once review is turned on, and the vendor
                is not notified of it.
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
                      Approved
                    </Badge>
                  ) : requestedAt ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-400"
                    >
                      Waiting for review
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      No access
                    </Badge>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {hasAccess
                      ? `Since ${formatPreorderAccessDate(state.preorder?.approvedAt) || "—"}`
                      : requestedAt
                        ? `Asked ${formatPreorderAccessDate(requestedAt) || "recently"}`
                        : "Has not asked for access"}
                  </span>
                </div>
                {note ? (
                  <p className="text-muted-foreground text-xs break-words">
                    Last note: {note}
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
                      Withdraw access
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => approve(vendor)}
                      >
                        {requestedAt ? "Approve" : "Grant access"}
                      </Button>
                      {requestedAt ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => refuse(vendor, "decline")}
                        >
                          Decline
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            <p className="text-muted-foreground text-xs">
              Once approved, release dates can be up to{" "}
              {state.policy.maxLeadDays} days out and deposits up to{" "}
              {state.policy.maxDepositPercent}% of the price. Withdrawing
              access never pulls listings that are already selling.
            </p>
          </>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}
