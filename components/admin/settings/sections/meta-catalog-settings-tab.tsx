"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { BookOpen, Check, Copy, ExternalLink, RadioTower, RefreshCw } from "lucide-react";

import {
  SetupGuide,
  SetupGuideCaution,
  SetupGuideSection,
  SetupGuideSteps,
} from "@/components/admin/setup-guide";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import {
  META_CATALOG_ENDPOINT as ENDPOINT,
  jsonInit,
  metaRequest,
  type MetaPageDto as FeedDto,
} from "./meta-catalog/api";
import { LiveSyncPanel } from "./meta-catalog/live-sync-panel";
import { SettingsTabHeader } from "./settings-tab-header";

const request = (path: string, init?: RequestInit) => metaRequest<FeedDto>(path, init);

/**
 * Settings → Meta catalog. The switch says whether Meta gets the products at
 * all; inside, how: the scheduled feed Meta Commerce Manager reads
 * (app/feeds/meta), or live sync through the Catalog API
 * (./meta-catalog/live-sync-panel.tsx) — one at a time, so a catalog never
 * has two sources writing every item.
 *
 * For the feed: the URL to paste, a way to replace it, and the setup steps.
 * What Meta saw last is one line, and only what needs doing about it — the
 * items it was not sent — says more.
 *
 * Saved as it is changed, like the other switches that act at once: there is
 * nothing to fill in, so a save bar would only add a step.
 */
export function MetaCatalogSettingsTab() {
  const t = useTranslations("admin.settings.metaCatalog");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { currency } = useCurrency();
  const [feed, setFeed] = useState<FeedDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setFeed(await request(ENDPOINT));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      const next = await request(ENDPOINT, jsonInit("PATCH", { enabled }));
      setFeed(next);
      const live = next.source === "live";
      toast.success(
        enabled ? t(live ? "toast.liveOn" : "toast.on") : t(live ? "toast.liveOff" : "toast.off"),
      );
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("toast.failed"));
    } finally {
      setSaving(false);
    }
  };

  const chooseSource = async (source: "feed" | "live") => {
    if (!feed || feed.source === source) return;
    setSaving(true);
    try {
      setFeed(await request(ENDPOINT, jsonInit("PATCH", { source })));
      toast.success(t(source === "live" ? "toast.sourceLive" : "toast.sourceFeed"));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("toast.failed"));
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    setSaving(true);
    try {
      setFeed(await request(`${ENDPOINT}/rotate`, { method: "POST" }));
      setConfirmRotate(false);
      toast.success(t("toast.rotated"));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("toast.failed"));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!feed?.feedUrl) return;
    try {
      await navigator.clipboard.writeText(feed.feedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const enabled = feed?.enabled === true;
  const live = feed?.source === "live";
  const skipped = feed?.lastSkipped;
  // Counts in the page's own digits, as the plural messages print theirs.
  const skippedParts = skipped
    ? (
        [
          ["status.preorder", skipped.preorder],
          ["status.noImage", skipped.noImage],
          ["status.noPrice", skipped.noPrice],
        ] as const
      )
        .filter(([, count]) => count > 0)
        .map(([key, count]) => t(key, { count: format.number(count) }))
    : [];

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("title")}
        description={
          enabled ? (live ? t("descriptionLive") : t("description")) : t("descriptionOff")
        }
        control={
          feed ? (
            <Switch
              className="mt-1"
              checked={enabled}
              disabled={saving}
              aria-label={t("title")}
              onCheckedChange={(on) => void toggle(on)}
            />
          ) : null
        }
      />

      {!feed ? (
        failed ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t("loadFailed")}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                {t("retry")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Skeleton className="h-40 w-full rounded-lg" />
        )
      ) : enabled ? (
        <Card>
          <CardContent className="space-y-4">
            <fieldset className="space-y-2" disabled={saving}>
              <legend className="mb-2 text-sm font-medium">{t("source.title")}</legend>
              <RadioGroup
                value={feed.source}
                onValueChange={(value) => void chooseSource(value as "feed" | "live")}
                className="grid gap-3 md:grid-cols-2"
              >
                {(
                  [
                    ["feed", RefreshCw],
                    ["live", RadioTower],
                  ] as const
                ).map(([value, Icon]) => (
                  <label
                    key={value}
                    className="hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-[[data-state=checked]]:border-primary"
                  >
                    <RadioGroupItem value={value} className="mt-0.5" />
                    <span className="space-y-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="text-muted-foreground size-3.5" />
                        {t(`source.${value}`)}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {t(`source.${value}Hint`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>

            {live ? (
              <div className="border-t pt-4">
                <LiveSyncPanel page={feed} onPage={setFeed} />
              </div>
            ) : feed.feedUrl ? (
              <div className="space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <label htmlFor="meta-feed-url" className="block text-sm font-medium">
                    {t("feedUrl")}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {/* A URL reads left to right in every language. */}
                    <div dir="ltr" className="relative min-w-0 flex-1">
                      <Input
                        id="meta-feed-url"
                        readOnly
                        value={feed.feedUrl}
                        onFocus={(event) => event.currentTarget.select()}
                        className="pr-10 font-mono text-xs"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        onClick={() => void copy()}
                        aria-label={t("copy")}
                        className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1.5 transition-colors"
                      >
                        {copied ? (
                          <Check className="size-4 text-emerald-600" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => setConfirmRotate(true)}
                    >
                      <RefreshCw className="mr-2 size-4" />
                      {t("rotate")}
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">{t("feedUrlHint")}</p>
                </div>

                <div className="text-sm">
                  <p className={feed.lastFetchedAt ? "" : "text-muted-foreground"}>
                    {feed.lastFetchedAt
                      ? t("status.fetched", {
                          when: format.relativeTime(new Date(feed.lastFetchedAt), now),
                          count: feed.lastItemCount ?? 0,
                        })
                      : t("status.notFetched")}
                  </p>
                  {skippedParts.length > 0 ? (
                    <p className="text-amber-700 dark:text-amber-400">
                      {t("status.skipped", {
                        reasons: format.list(skippedParts, { type: "unit" }),
                      })}
                    </p>
                  ) : null}
                </div>

                {/* Open until Meta has fetched the URL once; folded after. */}
                <SetupGuide
                  key={feed.lastFetchedAt ? "fetched" : "new"}
                  defaultOpen={feed.lastFetchedAt ? [] : ["setup"]}
                >
                  <SetupGuideSection value="setup" icon={BookOpen} title={t("guide.title")}>
                    <SetupGuideSteps
                      steps={[
                        { key: "open", text: t("guide.step1") },
                        { key: "source", text: t("guide.step2") },
                        { key: "url", text: t("guide.step3") },
                        {
                          key: "schedule",
                          text: t("guide.step4", { currency: currency.code }),
                        },
                        { key: "pixel", text: t("guide.step5") },
                        { key: "issues", text: t("guide.step6") },
                      ]}
                    />
                    <SetupGuideCaution>{t("guide.caution")}</SetupGuideCaution>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button asChild type="button" variant="outline" size="sm">
                        <a
                          href="https://business.facebook.com/commerce"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("guide.link")}
                          <ExternalLink className="ml-2 size-3.5 rtl:-scale-x-100" />
                        </a>
                      </Button>
                      <p className="text-muted-foreground text-xs">{t("guide.docs")}</p>
                    </div>
                  </SetupGuideSection>
                </SetupGuide>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        onConfirm={() => void rotate()}
        loading={saving}
        type="warning"
        title={t("rotateConfirm.title")}
        description={t("rotateConfirm.description")}
        confirmText={t("rotateConfirm.confirm")}
        cancelText={t("rotateConfirm.cancel")}
      />
    </div>
  );
}
