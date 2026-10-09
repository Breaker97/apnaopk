"use client";

import { useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { BookOpen, CircleCheck, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import {
  SetupGuide,
  SetupGuideCaution,
  SetupGuideSection,
  SetupGuideSteps,
} from "@/components/admin/setup-guide";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  META_CATALOG_ENDPOINT,
  jsonInit,
  metaRequest,
  type MetaConnectionTest,
  type MetaPageDto,
  type MetaPauseCode,
} from "./api";
import { LiveRejectedList } from "./live-rejected-list";

const CATALOG_ID = /^\d{5,30}$/;

/**
 * Live sync's half of Settings → Meta catalog: the catalog and token, whether
 * they work, and one line on how sending is going. Anything that needs the
 * admin — a pause, items Meta refused, a server setting missing — gets a line
 * of its own, and only then.
 */
export function LiveSyncPanel({
  page,
  onPage,
}: {
  page: MetaPageDto;
  onPage: (page: MetaPageDto) => void;
}) {
  const t = useTranslations("admin.settings.metaCatalog.live");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const live = page.live;

  const [catalogId, setCatalogId] = useState(live.catalogId ?? "");
  const [token, setToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);
  const [test, setTest] = useState<MetaConnectionTest | null>(null);

  const catalogIdValid = CATALOG_ID.test(catalogId.trim());
  const dirty =
    catalogId.trim() !== (live.catalogId ?? "") || token.trim() !== "" || removeToken;
  const connected = Boolean(live.verifiedAt) && !live.paused;
  const ago = (iso: string) => format.relativeTime(new Date(iso), now);

  const testMessage = (result: MetaConnectionTest) => {
    if (result.ok) return t("connected", { name: result.catalogName });
    if (result.kind === "auth") return t(`problem.${result.pauseCode ?? "token"}`);
    if (result.kind === "config") return t("problem.config");
    if (result.kind === "throttle") return t("problem.throttle");
    return t("problem.other", { message: result.message });
  };

  const run = async (
    kind: "save" | "test" | "sync",
    call: () => Promise<MetaPageDto & { test?: MetaConnectionTest | null }>,
  ) => {
    setBusy(kind);
    try {
      const next = await call();
      onPage(next);
      if (kind === "save") {
        setToken("");
        setRemoveToken(false);
        setCatalogId(next.live.catalogId ?? "");
      }
      if (kind === "sync") toast.success(t("toast.syncStarted"));
      if (next.test !== undefined) {
        setTest(next.test);
        if (next.test?.ok) toast.success(testMessage(next.test));
        else if (kind === "save") toast.success(t("toast.saved"));
      }
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("toast.failed"));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", () =>
      metaRequest(
        `${META_CATALOG_ENDPOINT}/live`,
        jsonInit("PUT", {
          catalogId: catalogId.trim(),
          ...(removeToken ? { accessToken: null } : token.trim() ? { accessToken: token.trim() } : {}),
        }),
      ),
    );
  const testConnection = () =>
    run("test", () => metaRequest(`${META_CATALOG_ENDPOINT}/live/test`, jsonInit("POST")));
  const syncAll = () =>
    run("sync", () => metaRequest(`${META_CATALOG_ENDPOINT}/live/sync`, jsonInit("POST")));

  const pauseCode: MetaPauseCode | null = live.paused?.code ?? null;
  const showTestFailure = test && !test.ok && !live.paused;
  const statusParts = [
    live.lastSyncAt ? t("status.lastSync", { when: ago(live.lastSyncAt) }) : t("status.never"),
    ...(live.waiting > 0 ? [t("status.waiting", { count: live.waiting })] : []),
    ...(live.checking ? [t("status.checking")] : []),
  ];
  const skipped = live.skipped;
  const skippedParts = skipped
    ? (
        [
          ["preorder", skipped.preorder],
          ["noImage", skipped.noImage],
          ["noPrice", skipped.noPrice],
        ] as const
      )
        .filter(([, count]) => count > 0)
        .map(([key, count]) => t(`skipped.${key}`, { count: format.number(count) }))
    : [];

  return (
    <div className="space-y-4">
      {live.paused && pauseCode ? (
        <WarningBanner tone="danger" title={t("paused.title")}>
          <p className="text-sm">{t(`problem.${pauseCode}`)}</p>
          <p className="text-muted-foreground text-xs">{t("paused.kept")}</p>
          {live.paused.reason ? (
            <p className="text-muted-foreground text-xs break-words" dir="auto">
              {t("paused.meta", { reason: live.paused.reason })}
            </p>
          ) : null}
        </WarningBanner>
      ) : null}

      {!live.graphVersionSet ? (
        <WarningBanner title={t("setup.version")}>
          <p className="text-muted-foreground text-xs">{t("setup.versionHint")}</p>
        </WarningBanner>
      ) : null}
      {!live.canStoreToken && !live.tokenSet ? (
        <WarningBanner title={t("setup.key")}>
          <p className="text-muted-foreground text-xs">{t("setup.keyHint")}</p>
        </WarningBanner>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {/* As tall as the token's label row, which carries a Remove button. */}
          <div className="flex min-h-5 items-center">
            <Label htmlFor="meta-catalog-id">{t("catalogId")}</Label>
          </div>
          <Input
            id="meta-catalog-id"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            value={catalogId}
            onChange={(event) => setCatalogId(event.target.value.replace(/\s+/g, ""))}
            aria-invalid={catalogId.trim() !== "" && !catalogIdValid ? true : undefined}
            className="font-mono"
          />
          <p className="text-muted-foreground text-xs">{t("catalogIdHint")}</p>
        </div>
        <div className="min-w-0">
          <SecretInput
            id="meta-catalog-token"
            label={t("token")}
            labelRowClassName="min-h-5"
            value={token}
            onChange={(value) => {
              setToken(value);
              if (value) setRemoveToken(false);
            }}
            secretSet={live.tokenSet && !removeToken}
            maskedHint={live.tokenHint ?? undefined}
            placeholderWhenSet={t("tokenSaved")}
            onClear={live.tokenSet ? () => setRemoveToken(true) : undefined}
            helperText={removeToken ? t("tokenRemoving") : t("tokenHint")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || !catalogIdValid || busy !== null}
        >
          {busy === "save" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t("save")}
        </Button>
        {live.catalogId && live.tokenSet ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void testConnection()}
            disabled={busy !== null || dirty}
          >
            {busy === "test" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t("test")}
          </Button>
        ) : null}
        {connected && live.catalogName ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-4 shrink-0" />
            <span className="truncate">{t("connected", { name: live.catalogName })}</span>
          </span>
        ) : null}
      </div>
      {showTestFailure ? (
        <p className="text-destructive text-sm" role="alert">
          {testMessage(test)}
        </p>
      ) : null}

      {connected ? (
        <div className="space-y-1 border-t pt-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground">{statusParts.join(" · ")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void syncAll()}
              disabled={busy !== null}
            >
              {busy === "sync" ? (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-3.5" />
              )}
              {t("syncNow")}
            </Button>
          </div>
          {live.throttledUntil ? (
            <p className="text-amber-700 dark:text-amber-400">
              {t("status.throttled", { when: ago(live.throttledUntil) })}
            </p>
          ) : null}
          {live.lastRunError ? (
            <p className="text-amber-700 dark:text-amber-400" dir="auto">
              {t("status.runError", { message: live.lastRunError })}
            </p>
          ) : null}
          {skippedParts.length > 0 ? (
            <p className="text-muted-foreground">
              {t("skipped.line", { reasons: format.list(skippedParts, { type: "unit" }) })}
            </p>
          ) : null}
        </div>
      ) : null}

      {live.rejected > 0 || live.failing > 0 ? (
        <LiveRejectedList rejected={live.rejected} refreshKey={live.lastSyncAt ?? ""} />
      ) : null}

      {/* Open until the connection has worked once; folded after. */}
      <SetupGuide
        key={live.verifiedAt ? "connected" : "new"}
        defaultOpen={live.verifiedAt ? [] : ["setup"]}
      >
        <SetupGuideSection value="setup" icon={BookOpen} title={t("guide.title")}>
          <SetupGuideSteps
            steps={[
              { key: "user", text: t("guide.step1") },
              { key: "assign", text: t("guide.step2") },
              { key: "token", text: t("guide.step3"), code: "catalog_management" },
              { key: "id", text: t("guide.step4") },
              { key: "save", text: t("guide.step5") },
              { key: "feed", text: t("guide.step6") },
            ]}
          />
          <SetupGuideCaution>{t("guide.caution")}</SetupGuideCaution>
          <p className="text-muted-foreground text-xs">{t("guide.off")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild type="button" variant="outline" size="sm">
              <a
                href="https://business.facebook.com/settings/system-users"
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
  );
}

