"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/ui/number-input";
import { apiClient } from "@/lib/api/client";
import type { Settings } from "@/components/admin/settings/types";
import { SettingSwitchRow } from "@/components/admin/settings/fields/setting-switch-row";
import {
  formatPreorderAccessDate as formatDate,
  usePreorderAccessDecision,
} from "@/components/admin/vendors/use-preorder-access-decision";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

/**
 * The Vendor access card's anchor. Access-request notifications and emails
 * link here (`PREORDER_ACCESS_REVIEW_PATH`), so the queue is on screen
 * without scrolling past every other marketplace setting.
 */
const VENDOR_ACCESS_ANCHOR = "preorder-access";

/**
 * Guard rails for pre-orders, and the queue of vendors asking to sell one.
 *
 * A pre-order takes a shopper's money for goods a vendor has not made yet, and
 * that money lands on the platform's gateway — so an over-promised date or an
 * outsized deposit becomes the platform's refund and the platform's chargeback.
 * Every control here exists to bound that exposure.
 *
 * The switches ship permissive on purpose: a store already selling pre-orders
 * when it updates must keep selling them. Tightening is a decision an operator
 * makes here, deliberately, not one a version bump makes for them.
 */

interface VendorRow {
  _id: string;
  storeName?: string;
  preorder?: {
    enabled?: boolean;
    requestedAt?: string | null;
    approvedAt?: string | null;
    note?: string | null;
  };
}

export function PreorderSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const preorder = props.settings.preorder;
  const enabled = preorder?.enabled ?? true;
  const requireApproval = preorder?.requireVendorApproval ?? false;
  const autoRelease = preorder?.autoRelease ?? false;

  const [pending, setPending] = useState<VendorRow[]>([]);
  const [approved, setApproved] = useState<VendorRow[]>([]);
  // Starts true so "No vendor has asked" does not flash before the first load.
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);

  // State is set only in the request's callbacks, so the mount effect below
  // does not render a second time before the answer is in.
  const fetchQueue = useCallback(
    () =>
      apiClient
        .get<{
          pending: VendorRow[];
          enabled: VendorRow[];
        }>("/api/admin/vendors/preorder-access")
        .then(
          (result) => {
            setPending(result?.pending || []);
            setApproved(result?.enabled || []);
          },
          () => {
            // A queue that will not load must not break the settings form
            // around it; the lists simply stay empty and the switches keep
            // working.
            setPending([]);
            setApproved([]);
          },
        )
        .finally(() => setIsLoadingQueue(false)),
    [],
  );

  const loadQueue = useCallback(() => {
    setIsLoadingQueue(true);
    return fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  // This tab mounts only once settings have loaded, which is after the
  // browser's own jump-to-anchor has already given up.
  useEffect(() => {
    if (window.location.hash !== `#${VENDOR_ACCESS_ANCHOR}`) return;
    document
      .getElementById(VENDOR_ACCESS_ANCHOR)
      ?.scrollIntoView({ block: "start" });
  }, []);

  const { busyVendorId, approve, refuse, dialog } =
    usePreorderAccessDecision(loadQueue);

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title="Pre-orders"
        description="What a vendor may promise when they sell something before it exists — and who is allowed to."
      />

      <Card>
        <CardContent className="space-y-4">
          <SettingSwitchRow
            title="Enable pre-orders"
            description="Master switch. When off, no vendor can open a new pre-order. Listings that are already selling are not withdrawn."
            checked={enabled}
            onCheckedChange={(v) => props.updateField("preorder.enabled", v)}
          />

          {enabled ? (
            <>
              <SettingSwitchRow
                title="Review vendors before they can sell pre-orders"
                description="When on, a vendor needs your approval before opening their first pre-order. Existing listings keep selling either way."
                checked={requireApproval}
                onCheckedChange={(v) =>
                  props.updateField("preorder.requireVendorApproval", v)
                }
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Furthest release date
                  </label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      min={1}
                      max={730}
                      step={1}
                      className="w-24"
                      value={preorder?.maxLeadDays ?? 180}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next !== undefined)
                          props.updateField("preorder.maxLeadDays", next);
                      }}
                    />
                    <span className="text-muted-foreground text-sm">
                      days ahead
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    The longer the wait, the longer a shopper can dispute the
                    charge.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Largest deposit</label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      min={0}
                      max={100}
                      step={1}
                      className="w-24"
                      value={preorder?.maxDepositPercent ?? 100}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next !== undefined)
                          props.updateField("preorder.maxDepositPercent", next);
                      }}
                    />
                    <span className="text-muted-foreground text-sm">
                      % of the price
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Applies to fixed amounts too, measured against the price.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Give up on an unpaid balance after
                  </label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      min={1}
                      max={365}
                      step={1}
                      className="w-24"
                      value={preorder?.expiryGraceDays ?? 14}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next !== undefined)
                          props.updateField("preorder.expiryGraceDays", next);
                      }}
                    />
                    <span className="text-muted-foreground text-sm">
                      days past the release date
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    The order is cancelled, the quota freed, and the deposit
                    refunded in full.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <SettingSwitchRow
                    title="Ask for the balance automatically"
                    description="On the release date, ask each pre-order for its remaining balance and release the ones already paid for. Leave this off if your dates slip — asking for money says the goods are ready."
                    checked={autoRelease}
                    onCheckedChange={(v) =>
                      props.updateField("preorder.autoRelease", v)
                    }
                  />
                  {autoRelease ? (
                    <div className="flex items-center gap-2 pt-1">
                      <NumberInput
                        min={0}
                        max={90}
                        step={1}
                        className="w-24"
                        value={preorder?.autoReleaseDelayDays ?? 0}
                        whenEmpty="keep"
                        normalize={Math.trunc}
                        onValueChange={(next) => {
                          if (next !== undefined)
                            props.updateField(
                              "preorder.autoReleaseDelayDays",
                              next,
                            );
                        }}
                      />
                      <span className="text-muted-foreground text-sm">
                        days after the release date
                      </span>
                    </div>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    A pre-order that is already paid in full is only released
                    once its stock is actually recorded — the calendar alone
                    never ships anything.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Hold back from pre-order payouts
                  </label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      min={0}
                      max={50}
                      step={1}
                      className="w-20"
                      value={preorder?.reservePercent ?? 0}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next !== undefined)
                          props.updateField("preorder.reservePercent", next);
                      }}
                    />
                    <span className="text-muted-foreground text-sm">% for</span>
                    <NumberInput
                      min={1}
                      max={365}
                      step={1}
                      className="w-20"
                      value={preorder?.reserveDays ?? 90}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next !== undefined)
                          props.updateField("preorder.reserveDays", next);
                      }}
                    />
                    <span className="text-muted-foreground text-sm">days</span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    A card dispute is counted from the expected delivery date,
                    so a pre-order can be charged back long after the vendor was
                    paid. Zero switches the reserve off.
                  </p>
                </div>
              </div>
            </>
          ) : null}

          <StickySaveFooter
            label="Save changes"
            isSaving={props.isSaving}
            isDirty={props.isDirty}
            disabled={props.isSaving || !props.isDirty}
            onSave={props.onSave}
          />
        </CardContent>
      </Card>

      {enabled ? (
        <Card id={VENDOR_ACCESS_ANCHOR} className="scroll-mt-24">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="text-muted-foreground h-4 w-4" />
              <h3 className="text-sm font-semibold">Vendor access</h3>
              {isLoadingQueue ? (
                <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              ) : null}
              {pending.length > 0 ? (
                <Badge variant="secondary">{pending.length} waiting</Badge>
              ) : null}
            </div>

            {!requireApproval ? (
              // Without this an admin working the queue would think they were
              // granting something that was never withheld.
              <p className="text-muted-foreground text-sm">
                Review is off, so every vendor can already open pre-orders.
                Approving here changes nothing until you turn review on above,
                and the vendor is not notified of it.
              </p>
            ) : null}

            {pending.length === 0 && approved.length === 0 && !isLoadingQueue ? (
              <p className="text-muted-foreground text-sm">
                No vendor has asked for pre-order access yet.
              </p>
            ) : null}

            {pending.map((vendor) => (
              <div
                key={vendor._id}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {vendor.storeName || "Unnamed store"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Asked {formatDate(vendor.preorder?.requestedAt) || "recently"}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busyVendorId === vendor._id}
                  onClick={() => approve(vendor)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyVendorId === vendor._id}
                  onClick={() => refuse(vendor, "decline")}
                >
                  Decline
                </Button>
              </div>
            ))}

            {approved.length > 0 ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Approved
                </p>
                {approved.map((vendor) => (
                  <div
                    key={vendor._id}
                    className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {vendor.storeName || "Unnamed store"}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Since {formatDate(vendor.preorder?.approvedAt) || "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyVendorId === vendor._id}
                      onClick={() => refuse(vendor, "revoke")}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  Revoking stops the next pre-order. Listings already selling
                  keep their promises — shoppers have paid deposits against
                  them.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {dialog}
    </div>
  );
}
