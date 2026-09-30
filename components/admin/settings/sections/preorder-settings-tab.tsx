"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/ui/number-input";
import { apiClient } from "@/lib/api/client";
import type { Settings } from "@/components/admin/settings/types";
import { SettingSwitchRow } from "@/components/admin/settings/fields/setting-switch-row";
import Link from "@/components/language/link";
import {
  formatPreorderAccessDate as formatDate,
  usePreorderAccessDecision,
} from "@/components/admin/vendors/use-preorder-access-decision";
import { SettingsTabHeader } from "./settings-tab-header";

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
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.preorder");
  const tAccess = useTranslations("admin.preorderAccess");
  const locale = useLocale();
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

  const askedLine = (requestedAt?: string | null) => {
    const date = formatDate(requestedAt, locale);
    return date ? tAccess("asked", { date }) : tAccess("askedRecently");
  };

  return (
    <div className="space-y-4">
      <SettingsTabHeader title={t("title")} description={t("description")} />

      <Card>
        <CardContent className="space-y-4">
          {/* The on/off switch is store-wide — it gates the admin's own
              products too — so it lives in Settings → Products; what is
              left here is what a VENDOR may promise once it is on. */}
          {enabled ? null : (
            <p className="text-muted-foreground text-sm">
              {t.rich("storeOff", {
                link: (chunks) => (
                  <Link
                    href="/admin/settings/products"
                    className="text-primary font-medium hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}

          {enabled ? (
            <>
              <SettingSwitchRow
                title={t("requireApproval.title")}
                description={t("requireApproval.description")}
                checked={requireApproval}
                onCheckedChange={(v) =>
                  props.updateField("preorder.requireVendorApproval", v)
                }
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("maxLead.label")}
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
                      {t("maxLead.unit")}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("maxLead.hint")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("maxDeposit.label")}
                  </label>
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
                      {t("maxDeposit.unit")}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("maxDeposit.hint")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("expiry.label")}
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
                      {t("expiry.unit")}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("expiry.hint")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <SettingSwitchRow
                    title={t("autoRelease.title")}
                    description={t("autoRelease.description")}
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
                        {t("autoRelease.unit")}
                      </span>
                    </div>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {t("autoRelease.hint")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t("reserve.label")}
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
                    <span className="text-muted-foreground text-sm">
                      {t("reserve.percentUnit")}
                    </span>
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
                    <span className="text-muted-foreground text-sm">
                      {t("reserve.daysUnit")}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("reserve.hint")}
                  </p>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {enabled ? (
        <Card id={VENDOR_ACCESS_ANCHOR} className="scroll-mt-24">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="text-muted-foreground h-4 w-4" />
              <h3 className="text-sm font-semibold">{t("access.title")}</h3>
              {isLoadingQueue ? (
                <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              ) : null}
              {pending.length > 0 ? (
                <Badge variant="secondary">
                  {t("access.waiting", { count: pending.length })}
                </Badge>
              ) : null}
            </div>

            {!requireApproval ? (
              // Without this an admin working the queue would think they were
              // granting something that was never withheld.
              <p className="text-muted-foreground text-sm">
                {t("access.reviewOff")}
              </p>
            ) : null}

            {pending.length === 0 && approved.length === 0 && !isLoadingQueue ? (
              <p className="text-muted-foreground text-sm">
                {t("access.empty")}
              </p>
            ) : null}

            {pending.map((vendor) => (
              <div
                key={vendor._id}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {vendor.storeName || tAccess("unnamedStore")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {askedLine(vendor.preorder?.requestedAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busyVendorId === vendor._id}
                  onClick={() => approve(vendor)}
                >
                  {tAccess("approve")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyVendorId === vendor._id}
                  onClick={() => refuse(vendor, "decline")}
                >
                  {tAccess("declineSubmit")}
                </Button>
              </div>
            ))}

            {approved.length > 0 ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  {tAccess("approvedBadge")}
                </p>
                {approved.map((vendor) => (
                  <div
                    key={vendor._id}
                    className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {vendor.storeName || tAccess("unnamedStore")}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {tAccess("since", {
                          date:
                            formatDate(vendor.preorder?.approvedAt, locale) ||
                            "—",
                        })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyVendorId === vendor._id}
                      onClick={() => refuse(vendor, "revoke")}
                    >
                      {tAccess("revoke")}
                    </Button>
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  {t("access.revokeNote")}
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
