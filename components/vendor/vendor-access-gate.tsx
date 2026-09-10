"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Check,
  CreditCard,
  Lock,
  Minus,
  Send,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import type { AccessLayer } from "@/lib/vendors/vendor-permissions";
import type { VendorPermissionPack } from "@/config/permissions.config";

const LAYER_ORDER: AccessLayer[] = ["policy", "plan", "grant", "lifecycle"];

const DURATION_KEYS = ["permanent", "30d", "90d"] as const;

interface VendorAccessGateProps {
  locale: string;
  layer: AccessLayer;
  pack: VendorPermissionPack;
  packLabel: string;
  planName: string | null;
  /** ISO date; only set while the vendor is inside the setup window. */
  paymentDueAt?: string | null;
  /** A pending request for this pack, if the vendor already sent one. */
  pendingRequest?: {
    id: string;
    requestedAt: string;
    duration: string;
  } | null;
  /** False when the marketplace is not selling plans — hides the upgrade door. */
  plansAvailable: boolean;
}

/**
 * The reason-carrying gate that replaced `/forbidden` for permission misses.
 *
 * Four layers can deny a request and each has a different answer, which is the
 * whole point: "not in your plan" is an upgrade, "your owner turned it off" is
 * a request, "finish your payment" is a checkout, and a marketplace policy is
 * genuinely a dead end. One 403 page for all four is what made permissions feel
 * arbitrary. See docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.5.
 */
export function VendorAccessGate({
  locale,
  layer,
  pack,
  packLabel,
  planName,
  paymentDueAt,
  pendingRequest,
  plansAvailable,
}: VendorAccessGateProps) {
  const t = useTranslations("vendor.accessGate");
  // Pack names are shared with the two admin screens, so they live in one
  // top-level namespace rather than being restated per surface.
  const tPacks = useTranslations("permissionPacks");
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("30d");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ id?: string } | null>(
    pendingRequest ? { id: pendingRequest.id } : null,
  );
  const [payLoading, setPayLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // The pack label the server sent is the English fallback; prefer the
  // translated one so the whole page speaks the vendor's locale.
  const label = tPacks.has(pack) ? tPacks(pack) : packLabel;
  const copy = buildCopy({ t, layer, pack: label, planName, plansAvailable });
  const blockedIndex = LAYER_ORDER.indexOf(layer);

  const durationHint = (key: string) =>
    key === "permanent"
      ? t("request.durationPermanentHint")
      : t("request.durationExpiryHint", { days: key === "90d" ? 90 : 30 });

  async function submitRequest() {
    if (reason.trim().length < 10) {
      toast.error(t("request.reasonTooShort"));
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/vendor/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack, reason: reason.trim(), duration }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.message || t("request.sendFailed"));
        return;
      }
      setSent({ id: body?.data?._id ? String(body.data._id) : undefined });
      setShowForm(false);
      toast.success(t("request.sendSucceeded"));
    } catch {
      toast.error(t("request.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  /**
   * Take the request back. Offered because the commonest reason a request goes
   * stale is that the vendor solved it another way — usually by upgrading — and
   * leaving it in the admin queue wastes someone's attention on a decision that
   * no longer matters.
   */
  async function withdrawRequest() {
    if (!sent?.id) return;
    setWithdrawing(true);
    try {
      const response = await fetch(`/api/vendor/access-requests/${sent.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.message || t("request.withdrawFailed"));
        return;
      }
      setSent(null);
      toast.success(t("request.withdrawSucceeded"));
    } catch {
      toast.error(t("request.withdrawFailed"));
    } finally {
      setWithdrawing(false);
    }
  }

  async function startPayment() {
    setPayLoading(true);
    try {
      const response = await fetch("/api/vendor/applications/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data?.url) {
        toast.error(body?.message || t("request.checkoutFailed"));
        return;
      }
      window.location.assign(body.data.url);
    } catch {
      toast.error(t("request.checkoutFailed"));
    } finally {
      setPayLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Card>
        <CardContent className="flex flex-col items-center gap-5 px-6 py-10 text-center sm:px-10">
          <span
            className={cn(
              "flex size-14 items-center justify-center rounded-2xl border",
              copy.tone === "primary" &&
                "border-primary/30 bg-primary/10 text-primary",
              copy.tone === "amber" &&
                "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
              copy.tone === "neutral" &&
                "border-border bg-muted text-muted-foreground",
            )}
          >
            {copy.icon === "spark" ? (
              <Sparkles className="size-6" />
            ) : copy.icon === "card" ? (
              <CreditCard className="size-6" />
            ) : (
              <Lock className="size-6" />
            )}
          </span>

          <div className="flex max-w-xl flex-col gap-2.5">
            <h1 className="text-2xl font-semibold text-pretty">{copy.title}</h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground text-pretty">
              {copy.body}
            </p>
          </div>

          {paymentDueAt && layer === "lifecycle" ? (
            <Badge
              variant="outline"
              className="border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            >
              {t("lifecycle.endsOn", {
                date: new Date(paymentDueAt).toLocaleDateString(locale),
              })}
            </Badge>
          ) : null}

          {sent ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-5 py-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {t("request.sentTitle")}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                {t("request.sentBody", { pack: label })}
              </p>
              {sent.id ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={withdrawing}
                  onClick={withdrawRequest}
                >
                  <Undo2 className="size-4" />
                  {withdrawing
                    ? t("actions.withdrawing")
                    : t("actions.withdraw")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {showForm ? (
            <div className="w-full max-w-xl space-y-4 text-left">
              <div className="space-y-2">
                <label
                  htmlFor="access-reason"
                  className="text-sm font-medium"
                >
                  {t("request.reasonLabel", { pack: label })}
                </label>
                <Textarea
                  id="access-reason"
                  rows={4}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("request.reasonPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("request.reasonHint")}
                </p>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">
                  {t("request.durationLabel")}
                </span>
                <div className="flex flex-wrap gap-2">
                  {DURATION_KEYS.map((key) => (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant={duration === key ? "default" : "outline"}
                      onClick={() => setDuration(key)}
                    >
                      {key === "permanent"
                        ? t("request.durationPermanent")
                        : key === "30d"
                          ? t("request.duration30")
                          : t("request.duration90")}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {durationHint(duration)}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  {t("actions.cancel")}
                </Button>
                <Button type="button" onClick={submitRequest} disabled={sending}>
                  <Send className="size-4" />
                  {sending ? t("actions.sending") : t("actions.send")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              {copy.showUpgrade ? (
                <Button asChild>
                  <Link href={`/${locale}/vendor/billing`}>
                    {t("actions.comparePlans")}
                    <ArrowUpRight className="size-4" />
                  </Link>
                </Button>
              ) : null}

              {copy.showPay ? (
                <Button type="button" onClick={startPayment} disabled={payLoading}>
                  <CreditCard className="size-4" />
                  {payLoading
                    ? t("actions.openingCheckout")
                    : t("actions.payNow")}
                </Button>
              ) : null}

              {copy.showRequest && !sent ? (
                <Button
                  type="button"
                  variant={copy.showUpgrade ? "outline" : "default"}
                  onClick={() => setShowForm(true)}
                >
                  <Send className="size-4" />
                  {t("actions.requestAccess")}
                </Button>
              ) : null}

              <Button asChild variant="outline">
                <Link href={`/${locale}/vendor/dashboard`}>
                  {t("actions.backToDashboard")}
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">{t("trace.title")}</CardTitle>
          <CardDescription>{t("trace.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {LAYER_ORDER.map((step, index) => {
            const isBlocked = index === blockedIndex;
            const isSkipped = index > blockedIndex;
            return (
              <div
                key={step}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5",
                  isBlocked && "border border-destructive/30 bg-destructive/5",
                  !isBlocked && !isSkipped && "bg-emerald-500/5",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border",
                    isBlocked &&
                      "border-destructive/30 bg-destructive/10 text-destructive",
                    isSkipped && "border-border bg-muted text-muted-foreground",
                    !isBlocked &&
                      !isSkipped &&
                      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {isBlocked ? (
                    <X className="size-3.5" />
                  ) : isSkipped ? (
                    <Minus className="size-3.5" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">
                    {t(`layers.${step}`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {isBlocked
                      ? copy.traceReason
                      : isSkipped
                        ? t("trace.notReachedDetail")
                        : t("trace.passed")}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-semibold tracking-wide uppercase",
                    isBlocked && "text-destructive",
                    isSkipped && "text-muted-foreground",
                    !isBlocked &&
                      !isSkipped &&
                      "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {isBlocked
                    ? t("trace.blocked")
                    : isSkipped
                      ? t("trace.notReached")
                      : t("trace.passed")}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The message and the door, per denying layer.
 *
 * `pack` arrives already translated and is interpolated rather than
 * concatenated: a sentence assembled from fragments cannot be reordered by a
 * translator, and several of these need the pack name in a different position
 * in other languages.
 */
function buildCopy({
  t,
  layer,
  pack,
  planName,
  plansAvailable,
}: {
  t: ReturnType<typeof useTranslations>;
  layer: AccessLayer;
  pack: string;
  planName: string | null;
  plansAvailable: boolean;
}) {
  switch (layer) {
    case "policy":
      return {
        tone: "neutral" as const,
        icon: "lock" as const,
        title: t("policy.title", { pack }),
        body: t("policy.body"),
        traceReason: t("policy.reason"),
        showUpgrade: false,
        showRequest: false,
        showPay: false,
      };
    case "lifecycle":
      return {
        tone: "amber" as const,
        icon: "card" as const,
        title: t("lifecycle.title", { pack }),
        body: t("lifecycle.body"),
        traceReason: t("lifecycle.reason"),
        showUpgrade: false,
        showRequest: false,
        showPay: true,
      };
    case "grant":
      return {
        tone: "primary" as const,
        icon: "lock" as const,
        title: t("grant.title", { pack }),
        body: t("grant.body", { pack }),
        traceReason: t("grant.reason"),
        showUpgrade: false,
        showRequest: true,
        showPay: false,
      };
    case "plan":
    default: {
      const plan = planName ?? t("plan.currentPlan");
      return {
        tone: "primary" as const,
        icon: "spark" as const,
        title: plansAvailable
          ? t("plan.title", { pack, plan })
          : t("plan.titleNoPlans", { pack }),
        body: plansAvailable
          ? t("plan.body")
          : t("plan.bodyNoPlans", { pack }),
        traceReason: plansAvailable
          ? t("plan.reason", { pack, plan })
          : t("plan.reasonNoPlans", { pack }),
        showUpgrade: plansAvailable,
        showRequest: true,
        showPay: false,
      };
    }
  }
}
