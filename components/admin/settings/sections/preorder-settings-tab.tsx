"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/ui/number-input";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { Settings } from "@/components/admin/settings/types";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
  SettingUnit,
} from "@/components/admin/settings/fields/setting-row";
import Link from "@/components/language/link";
import {
  formatPreorderAccessDate as formatDate,
  usePreorderAccessDecision,
} from "@/components/admin/vendors/use-preorder-access-decision";

/**
 * The Vendor access card's anchor. Access-request notifications and emails
 * link here (`PREORDER_ACCESS_REVIEW_PATH`), so the queue is on screen
 * without scrolling past every other marketplace setting.
 */
const VENDOR_ACCESS_ANCHOR = "preorder-access";

/**
 * Guard rails for vendor pre-orders, and the queue of vendors asking to sell
 * one.
 *
 * A pre-order takes a shopper's money for goods a vendor has not made yet, and
 * that money lands on the platform's gateway — so an over-promised date or an
 * outsized deposit becomes the platform's refund and the platform's chargeback.
 * Every control here exists to bound that exposure. The rules every pre-order
 * follows, the store's own included (asking for the balance, giving up on it),
 * are in Settings → Products (preorder-rule-keys.ts).
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

  const [pending, setPending] = useState<VendorRow[]>([]);
  const [approved, setApproved] = useState<VendorRow[]>([]);
  const [showApproved, setShowApproved] = useState(false);
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

  const settingsProductsLink = (chunks: ReactNode) => (
    <Link
      href="/admin/settings/products"
      className="text-primary font-medium hover:underline"
    >
      {chunks}
    </Link>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* The on/off switch is store-wide — it gates the admin's own
              products too — so it lives in Settings → Products; what is
              left here is what a VENDOR may promise once it is on. */}
          {enabled ? (
            <>
              <SettingList>
                <SettingSwitchItem
                  title={t("requireApproval.title")}
                  description={t("requireApproval.description")}
                  checked={requireApproval}
                  onCheckedChange={(value) =>
                    props.updateField("preorder.requireVendorApproval", value)
                  }
                />

                <SettingRow
                  inputId="preorder-max-lead"
                  label={t("maxLead.label")}
                  hint={t("maxLead.hint")}
                >
                  <NumberInput
                    id="preorder-max-lead"
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
                  <SettingUnit>{t("maxLead.unit")}</SettingUnit>
                </SettingRow>

                <SettingRow
                  inputId="preorder-max-deposit"
                  label={t("maxDeposit.label")}
                  hint={t("maxDeposit.hint")}
                >
                  <NumberInput
                    id="preorder-max-deposit"
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
                  <SettingUnit>{t("maxDeposit.unit")}</SettingUnit>
                </SettingRow>

                <SettingRow
                  inputId="preorder-reserve-percent"
                  label={t("reserve.label")}
                  hint={t("reserve.hint")}
                >
                  <NumberInput
                    id="preorder-reserve-percent"
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
                  <SettingUnit>{t("reserve.percentUnit")}</SettingUnit>
                  <NumberInput
                    min={1}
                    max={365}
                    step={1}
                    className="w-20"
                    aria-label={`${t("reserve.label")}: ${t("reserve.daysUnit")}`}
                    value={preorder?.reserveDays ?? 90}
                    whenEmpty="keep"
                    normalize={Math.trunc}
                    onValueChange={(next) => {
                      if (next !== undefined)
                        props.updateField("preorder.reserveDays", next);
                    }}
                  />
                  <SettingUnit>{t("reserve.daysUnit")}</SettingUnit>
                </SettingRow>
              </SettingList>
              <p className="text-muted-foreground text-xs">
                {t.rich("movedNote", { link: settingsProductsLink })}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t.rich("storeOff", { link: settingsProductsLink })}
            </p>
          )}
        </CardContent>
      </Card>

      {enabled ? (
        <Card id={VENDOR_ACCESS_ANCHOR} className="scroll-mt-24">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{tAccess("card.title")}</CardTitle>
              {isLoadingQueue ? (
                <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
              ) : null}
              {pending.length > 0 ? (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                >
                  {t("access.waiting", { count: pending.length })}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
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

            {pending.length > 0 || approved.length > 0 ? (
              <div className="@container divide-y overflow-hidden rounded-lg border">
                {pending.map((vendor) => (
                  <QueueRow
                    key={vendor._id}
                    name={vendor.storeName || tAccess("unnamedStore")}
                    detail={askedLine(vendor.preorder?.requestedAt)}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyVendorId === vendor._id}
                      onClick={() => refuse(vendor, "decline")}
                    >
                      {tAccess("declineSubmit")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyVendorId === vendor._id}
                      onClick={() => approve(vendor)}
                    >
                      {tAccess("approve")}
                    </Button>
                  </QueueRow>
                ))}

                {approved.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      aria-expanded={showApproved}
                      onClick={() => setShowApproved((open) => !open)}
                      className="hover:bg-muted/40 flex w-full items-center gap-2 px-4 py-3 text-start text-sm font-medium transition-colors"
                    >
                      <span className="flex-1">
                        {t("access.approvedToggle", { count: approved.length })}
                      </span>
                      <ChevronDown
                        className={cn(
                          "text-muted-foreground size-4 transition-transform",
                          showApproved && "rotate-180",
                        )}
                      />
                    </button>
                    {showApproved ? (
                      <div className="bg-muted/30 divide-y border-t">
                        {approved.map((vendor) => (
                          <QueueRow
                            key={vendor._id}
                            muted
                            name={vendor.storeName || tAccess("unnamedStore")}
                            detail={tAccess("since", {
                              date:
                                formatDate(vendor.preorder?.approvedAt, locale) ||
                                "—",
                            })}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyVendorId === vendor._id}
                              onClick={() => refuse(vendor, "revoke")}
                            >
                              {tAccess("revoke")}
                            </Button>
                          </QueueRow>
                        ))}
                        <p className="text-muted-foreground px-4 py-3 text-xs">
                          {t("access.revokeNote")}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {dialog}
    </>
  );
}

/** A vendor in the access queue, with the decisions that apply to it. */
function QueueRow({
  name,
  detail,
  muted,
  children,
}: {
  name: string;
  detail: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 basis-32">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
      <div className="flex w-full gap-2 *:flex-1 @md:w-auto @md:*:flex-none">
        {children}
      </div>
    </div>
  );
}
