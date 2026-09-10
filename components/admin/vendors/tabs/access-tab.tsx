"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Info,
  Minus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { VendorPermission } from "@/config/permissions.config";
import {
  buildPackRows,
  cyclePackOverride,
  cyclePermissionOverride,
  editOverrideDetail,
  packOverrideLabel,
  type PackRow,
  type PackVerdict,
} from "../vendor-access-view";
import type { VendorTabProps } from "../vendor-detail-types";

/** `<input type="date">` speaks YYYY-MM-DD; the override stores an ISO instant. */
function toDateInputValue(iso?: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toISOString().slice(0, 10);
}

const VERDICT_STYLES: Record<
  PackVerdict,
  { className: string; icon: "ok" | "no" | "dash" | "part" }
> = {
  allowed: {
    icon: "ok",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  override: {
    icon: "ok",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  partial: {
    icon: "part",
    className: "border-primary/35 bg-primary/10 text-primary",
  },
  plan: {
    icon: "no",
    className:
      "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-400",
  },
  policy: {
    icon: "no",
    className: "border-border bg-muted text-muted-foreground",
  },
  revoked: {
    icon: "dash",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  lifecycle: {
    icon: "no",
    className:
      "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-400",
  },
};

function VerdictIcon({ kind }: { kind: "ok" | "no" | "dash" | "part" }) {
  if (kind === "ok") return <Check className="size-3.5" />;
  if (kind === "no") return <X className="size-3.5" />;
  if (kind === "dash") return <Minus className="size-3.5" />;
  return <CircleAlert className="size-3.5" />;
}

/**
 * Vendor → Access.
 *
 * Shows all four layers per capability pack, because a checkbox that may be a
 * no-op is worse than a greyed row with a reason. Only the Override column is
 * editable here: Policy is a global Settings field (a tick on a per-vendor
 * screen would change every vendor) and Plan is a billing action with its own
 * tab, so both are read-only and deep-link to where they live.
 *
 * See docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.6.
 */
export function AccessTab({
  form,
  setField,
  readOnly,
  locale,
  onOpenSubscription,
}: VendorTabProps & {
  locale?: string;
  /**
   * Switch to the Subscription tab. A callback rather than a link because the
   * plan lives on THIS page: a `?tab=` URL was never read by the shell, so the
   * "Not included" cell navigated to the same screen and landed on Profile.
   */
  onOpenSubscription?: () => void;
}) {
  const t = useTranslations("admin.vendorAccess");
  const tPacks = useTranslations("permissionPacks");
  const rows = useMemo(
    () => buildPackRows(form.packLayers ?? [], form.permissionOverrides ?? []),
    [form.packLayers, form.permissionOverrides],
  );

  const toggleExpanded = useCallback(
    (pack: string) => {
      setField("expandedPack", form.expandedPack === pack ? "" : pack);
    },
    [form.expandedPack, setField],
  );

  const totals = useMemo(() => {
    const packsAllowed = rows.filter(
      (row) => row.verdict === "allowed" || row.verdict === "override",
    ).length;
    const partial = rows.filter((row) => row.verdict === "partial").length;
    const notEntitled = rows.filter((row) => row.verdict === "plan").length;
    const byPolicy = rows.filter((row) => row.verdict === "policy").length;
    const revoked = rows.filter((row) => row.verdict === "revoked").length;
    const onHold = rows.filter((row) => row.verdict === "lifecycle").length;
    const permsAllowed = rows.reduce((sum, row) => sum + row.allowedCount, 0);
    const permsTotal = rows.reduce((sum, row) => sum + row.total, 0);
    return {
      packsAllowed,
      partial,
      notEntitled,
      byPolicy,
      revoked,
      onHold,
      permsAllowed,
      permsTotal,
    };
  }, [rows]);

  const overrides = form.permissionOverrides ?? [];

  // Marketplace policy lives on its own settings page — `/admin/settings` is a
  // redirect stub, so linking there with a `?section=` it does not read landed
  // the admin on General.
  const policyHref = locale
    ? `/${locale}/admin/settings/marketplace`
    : undefined;

  if (!rows.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("loading")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription className="max-w-3xl text-pretty">
                {t("description")}
              </CardDescription>
            </div>
            {!readOnly && overrides.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setField("permissionOverrides", [])}
              >
                {overrides.length === 1
                  ? t("clearOverrides", { count: overrides.length })
                  : t("clearOverridesPlural", { count: overrides.length })}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed",
              form.entitlementWarning
                ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                : "border-border bg-muted/40 text-muted-foreground",
            )}
          >
            <Info className="mt-0.5 size-4 shrink-0" />
            <p className="text-pretty">{form.entitlementNote}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              {t("totals.allowed", { count: totals.packsAllowed })}
            </Badge>
            {totals.partial > 0 && (
              <Badge
                variant="outline"
                className="border-primary/30 bg-primary/10 text-primary"
              >
                {t("totals.partial", { count: totals.partial })}
              </Badge>
            )}
            {totals.notEntitled > 0 && (
              <Badge
                variant="outline"
                className="border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-400"
              >
                {t("totals.notEntitled", { count: totals.notEntitled })}
              </Badge>
            )}
            {totals.byPolicy > 0 && (
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                {t("totals.byPolicy", { count: totals.byPolicy })}
              </Badge>
            )}
            {totals.revoked > 0 && (
              <Badge
                variant="outline"
                className="border-destructive/30 bg-destructive/10 text-destructive"
              >
                {t("totals.revoked", { count: totals.revoked })}
              </Badge>
            )}
            {totals.onHold > 0 && (
              <Badge
                variant="outline"
                className="border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-400"
              >
                {t(
                  form.accessMode === "setup"
                    ? "totals.onHoldSetup"
                    : "totals.onHold",
                  { count: totals.onHold },
                )}
              </Badge>
            )}
            <span className="ml-1 text-xs text-muted-foreground">
              {t("totals.summary", {
                allowed: totals.permsAllowed,
                total: totals.permsTotal,
              })}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      {t("columns.pack")}
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      {t("columns.policy")}
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      {t("columns.plan")}
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      {t("columns.override")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      {t("columns.effective")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <PackRowView
                      key={row.pack}
                      row={row}
                      striped={index % 2 !== 0}
                      expanded={form.expandedPack === row.pack}
                      readOnly={readOnly}
                      t={t}
                      tPacks={tPacks}
                      accessMode={form.accessMode}
                      policyHref={policyHref}
                      onOpenSubscription={onOpenSubscription}
                      onToggleExpanded={() => toggleExpanded(row.pack)}
                      onCyclePack={() =>
                        setField(
                          "permissionOverrides",
                          cyclePackOverride(overrides, row.pack),
                        )
                      }
                      onCyclePermission={(permission) =>
                        setField(
                          "permissionOverrides",
                          cyclePermissionOverride(overrides, permission),
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("overridesTitle")}</CardTitle>
          <CardDescription>{t("overridesDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {overrides.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-7 text-center text-sm text-muted-foreground">
              {t("overridesEmpty")}
            </div>
          ) : (
            <div className="space-y-2">
              {overrides.map((override) => (
                <div
                  key={override.permission}
                  className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      override.mode === "grant"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-destructive/30 bg-destructive/10 text-destructive",
                    )}
                  >
                    {t(override.mode === "grant" ? "overrideGrant" : "overrideRevoke")}
                  </Badge>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="font-mono text-xs">{override.permission}</p>
                    <Input
                      value={override.reason ?? ""}
                      disabled={readOnly}
                      maxLength={500}
                      placeholder={t("reasonPlaceholder")}
                      className="h-8 text-xs"
                      onChange={(event) =>
                        setField(
                          "permissionOverrides",
                          editOverrideDetail(overrides, override.permission, {
                            reason: event.target.value,
                          }),
                        )
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {override.grantedAt
                        ? t("setOn", {
                            date: new Date(
                              override.grantedAt,
                            ).toLocaleDateString(locale),
                          })
                        : t("unsaved")}
                    </p>
                  </div>
                  <label className="shrink-0 space-y-1.5 text-[11px] text-muted-foreground">
                    <span className="block">{t("expires")}</span>
                    <Input
                      type="date"
                      disabled={readOnly}
                      className="h-8 w-[10.5rem] text-xs"
                      value={toDateInputValue(override.expiresAt)}
                      onChange={(event) =>
                        setField(
                          "permissionOverrides",
                          editOverrideDetail(overrides, override.permission, {
                            expiresAt: event.target.value
                              ? new Date(
                                  `${event.target.value}T23:59:59`,
                                ).toISOString()
                              : null,
                          }),
                        )
                      }
                    />
                  </label>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setField(
                          "permissionOverrides",
                          overrides.filter(
                            (item) => item.permission !== override.permission,
                          ),
                        )
                      }
                    >
                      {t("remove")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PackRowView({
  t,
  tPacks,
  accessMode,
  row,
  striped,
  expanded,
  readOnly,
  policyHref,
  onOpenSubscription,
  onToggleExpanded,
  onCyclePack,
  onCyclePermission,
}: {
  t: ReturnType<typeof useTranslations>;
  tPacks: ReturnType<typeof useTranslations>;
  accessMode: "approved" | "setup" | "blocked";
  row: PackRow;
  striped: boolean;
  expanded: boolean;
  readOnly?: boolean;
  policyHref?: string;
  onOpenSubscription?: () => void;
  onToggleExpanded: () => void;
  onCyclePack: () => void;
  onCyclePermission: (permission: VendorPermission) => void;
}) {
  const verdict = VERDICT_STYLES[row.verdict];
  const overrideLabel = packOverrideLabel(row);

  return (
    <>
      <tr
        className={cn(
          "border-b",
          expanded ? "bg-accent" : striped ? "bg-muted/20" : undefined,
        )}
      >
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex w-full items-center gap-2 text-left"
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
            <span className="min-w-0">
              <span className="block font-medium">
                {tPacks.has(row.pack) ? tPacks(row.pack) : row.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("packPermissions", {
                  allowed: row.allowedCount,
                  total: row.total,
                })}
              </span>
            </span>
          </button>
        </td>

        <td className="px-2 py-3 text-center">
          {row.policy ? (
            <Badge variant="outline" className="gap-1.5 text-muted-foreground">
              <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
              {t("policyOn")}
            </Badge>
          ) : policyHref ? (
            <Button asChild variant="ghost" size="sm" className="h-7 px-2">
              <Link href={policyHref}>
                <span className="text-xs">{t("policyOff")}</span>
                <ArrowUpRight className="size-3" />
              </Link>
            </Button>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("policyOff")}
            </Badge>
          )}
        </td>

        <td className="px-2 py-3 text-center">
          {row.entitled ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              {t("planIncluded")}
            </Badge>
          ) : onOpenSubscription ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onOpenSubscription}
            >
              <span className="text-xs text-amber-700 dark:text-amber-400">
                {t("planNotIncluded")}
              </span>
              <ArrowUpRight className="size-3" />
            </Button>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-400"
            >
              {t("planNotIncluded")}
            </Badge>
          )}
        </td>

        <td className="px-2 py-3 text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={onCyclePack}
            className={cn(
              "h-7 rounded-full px-3 text-xs",
              overrideLabel.tone === "none" && "border-dashed text-muted-foreground",
              overrideLabel.tone === "grant" && "border-primary/40 bg-primary/10 text-primary",
              overrideLabel.tone === "revoke" &&
                "border-destructive/40 bg-destructive/10 text-destructive",
              overrideLabel.tone === "mixed" && "border-primary/40 bg-primary/5 text-primary",
            )}
          >
            {t(overrideLabel.key, { count: overrideLabel.count })}
          </Button>
        </td>

        <td className="px-4 py-3 text-right">
          <Badge
            variant="outline"
            className={cn("gap-1.5 font-semibold", verdict.className)}
          >
            <VerdictIcon kind={verdict.icon} />
            {row.verdict === "partial"
              ? t("packAllowed", {
                  allowed: row.allowedCount,
                  total: row.total,
                })
              : row.verdict === "lifecycle"
                ? // Only a vendor inside the unpaid setup window is waiting on
                  // money. A pending one is waiting on approval, a suspended one
                  // on a decision — telling either to go and pay is wrong.
                  t(
                    accessMode === "setup"
                      ? "verdicts.lifecycleSetup"
                      : "verdicts.lifecycle",
                  )
                : t(`verdicts.${row.verdict}`)}
          </Badge>
        </td>
      </tr>

      {expanded && (
        <tr className={cn("border-b", expanded && "bg-accent")}>
          <td colSpan={5} className="px-4 pb-4 pl-10">
            <p className="mb-2.5 text-xs text-muted-foreground text-pretty">
              {t("expandedIntro")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {row.permissions.map((item) => {
                const style = VERDICT_STYLES[item.verdict];
                return (
                  <button
                    key={item.permission}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onCyclePermission(item.permission)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      style.className,
                    )}
                  >
                    <VerdictIcon kind={style.icon} />
                    <span
                      className={cn(
                        item.verdict === "revoked" && "line-through",
                      )}
                    >
                      {item.permission}
                    </span>
                    {item.override && (
                      <span className="font-sans text-[10px] font-semibold tracking-wide uppercase opacity-75">
                        {item.override.mode}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground text-pretty">
              {t("expandedHelp")}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
