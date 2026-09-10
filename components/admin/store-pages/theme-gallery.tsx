"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Fingerprint,
  Palette,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from "@/components/admin/underline-tabs";
import { toast } from "@/components/ui/toast-notification";
import { BrandingPanel } from "@/components/admin/online-store/branding-panel";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  isThemePageTab,
  type ThemePageTab,
} from "@/lib/storefront/themes/page-tabs";
import { themePreviewSrc } from "@/lib/storefront/themes/preview";
import type { ThemeManifest } from "@/lib/storefront/themes/types";

/** Mirrors the activation API's `starter` modes — see its route doc. */
type StarterMode = "keep" | "draft" | "publish";

/**
 * The Themes page — the one hub for everything visual — in three tabs:
 *
 * - **Select theme**: the manifest-driven gallery + activation.
 * - **Branding**: the store's identity (logo set, brand colors, default
 *   appearance). GLOBAL — survives every theme switch.
 * - **Theme settings**: opens the theme editor (its own route — a
 *   three-pane workspace), where the active theme's tokens are edited.
 *
 * Content never lives here — these are design options. Other screens deep
 * link to a tab with `?tab=`; the param is kept in step as the admin
 * switches so a reload or a shared link lands on the same tab.
 */
export function ThemeGallery({
  locale,
  manifests,
  activeThemeId,
  initialTab = "theme",
}: {
  locale: string;
  manifests: (ThemeManifest & { hasStarter?: boolean })[];
  activeThemeId: string;
  initialTab?: ThemePageTab;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [tab, setTab] = useState<ThemePageTab>(initialTab);
  const [activeId, setActiveId] = useState(activeThemeId);
  const [pendingTheme, setPendingTheme] = useState<string | null>(null);
  // Choosing a theme should visibly change the storefront — that is what the
  // act means to a merchant — so going live is the default. The layout it
  // replaces lands in version history, one restore away.
  const [starterMode, setStarterMode] = useState<StarterMode>("publish");
  const [activating, setActivating] = useState(false);

  const active = manifests.find((manifest) => manifest.id === activeId);

  const activate = async (themeId: string, mode: StarterMode) => {
    setActivating(true);
    try {
      const result = await apiClient.post<{
        theme: string;
        values: Record<string, unknown>;
        seededTemplates: string[];
        draftedTemplates: string[];
        publishedTemplates: string[];
      }>("/api/admin/theme-settings/activate", {
        theme: themeId,
        starter: mode,
      });
      setActiveId(result.theme);
      toast.success(
        result.publishedTemplates.length > 0
          ? tSafe(
              "admin.themeSettings.activatedAndPublished",
              "Theme activated and its starter layout is live — open Customize to make it yours.",
            )
          : result.draftedTemplates.length > 0
            ? tSafe(
                "admin.themeSettings.activatedWithStarter",
                "Theme activated and its starter layout loaded into the home draft — review it in Customize, then publish.",
              )
            : tSafe(
                "admin.themeSettings.activated",
                "Theme activated — the storefront switched instantly and your pages are untouched.",
              ),
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.themeSettings.saveFailed", "Saving failed"),
      );
    } finally {
      setActivating(false);
      setPendingTheme(null);
    }
  };

  // The tab rides in the URL so a reload or a link from another screen
  // (checkout's "Branding" button, the redirect from the old Settings
  // drill) lands on the right one. replaceState, not router.push: switching
  // tabs is not navigation and must not pile up history entries.
  const changeTab = (value: string) => {
    if (!isThemePageTab(value)) return;
    setTab(value);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (value === "theme") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={changeTab} className="gap-5">
        <UnderlineTabsList>
          <UnderlineTabsTrigger value="theme" icon={Palette}>
            {tSafe("admin.themeSettings.tabs.theme", "Select theme")}
          </UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="branding" icon={Fingerprint}>
            {tSafe("admin.themeSettings.tabs.branding", "Branding")}
          </UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="settings" icon={SlidersHorizontal}>
            {tSafe("admin.themeSettings.tabs.settings", "Theme settings")}
          </UnderlineTabsTrigger>
        </UnderlineTabsList>

        <TabsContent value="theme">
          <div className="grid gap-4 lg:grid-cols-3">
            {manifests.map((manifest) => {
              const isActive = manifest.id === activeId;
              const isActivatable = !isActive && manifest.status === "stable";
              return (
                <Card
                  key={manifest.id}
                  className={cn(
                    // h-full + the mt-auto footer below keep every card's action
                    // button on the same baseline, whatever the description runs to.
                    "h-full gap-3 border-border/70 bg-card/95 py-4 transition-colors",
                    isActive && "border-emerald-500/40 shadow-sm",
                  )}
                >
                  <CardHeader className="gap-3 px-4">
                    <div
                      className={cn(
                        "relative aspect-[4/3] overflow-hidden rounded-lg",
                        manifest.preview
                          ? "border border-border/60"
                          : "border border-dashed border-border bg-muted/40",
                      )}
                    >
                      {manifest.preview ? (
                        // Real storefront capture of the template's own starter.
                        <Image
                          src={themePreviewSrc(manifest, "card")!}
                          alt={manifest.name}
                          fill
                          unoptimized
                          sizes="(min-width: 1024px) 30vw, 100vw"
                          className="object-cover object-top"
                        />
                      ) : (
                        // Nothing to screenshot yet. A washed-out wash of the
                        // theme's own accent keeps its identity, while the
                        // dashed frame reads "not ready" — the full-strength
                        // gradient read as the loudest, most clickable tile on
                        // the page, which is the opposite of the truth.
                        <>
                          <div
                            className={cn(
                              "absolute inset-0 bg-gradient-to-br opacity-15",
                              manifest.accent,
                            )}
                          />
                          <div className="relative flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                            <span className="flex size-10 items-center justify-center rounded-full bg-background/80 shadow-sm">
                              <Palette className="size-5" />
                            </span>
                            <span className="text-xs font-medium">
                              {tSafe(
                                "admin.onlineStoreThemePage.previewComingSoon",
                                "Preview coming soon",
                              )}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                    <div>
                      <CardTitle>
                        {tSafe(
                          `admin.onlineStoreThemePage.themes.${manifest.id}.name`,
                          manifest.name,
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1 text-sm">
                        {tSafe(
                          `admin.onlineStoreThemePage.themes.${manifest.id}.description`,
                          manifest.description,
                        )}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="mt-auto px-4">
                    {isActive ? (
                      // The live theme gets a SOLID green status row, not a
                      // dead button: a greyed-out primary reads as "broken",
                      // and with the card badges gone this is the only "you
                      // are here" marker. "Active" (state), never "Activated"
                      // (that's the toast's event wording) — and the key is
                      // already translated everywhere.
                      <div className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-semibold text-white">
                        <CheckCircle2 className="h-4 w-4" />
                        {tSafe("admin.onlineStoreThemePage.active", "Active")}
                      </div>
                    ) : isActivatable ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={activating}
                        onClick={() => setPendingTheme(manifest.id)}
                      >
                        {tSafe(
                          "admin.onlineStoreThemePage.activate",
                          "Use this theme",
                        )}
                      </Button>
                    ) : (
                      <Button variant="outline" disabled className="w-full">
                        {tSafe(
                          "admin.onlineStoreThemePage.comingSoon",
                          "Coming Soon",
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="branding">
          <BrandingPanel tSafe={tSafe} />
        </TabsContent>

        <TabsContent value="settings">
          {active ? (
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  {tSafe("admin.themeSettings.launchTitle", "Theme settings")}{" "}
                  <span className="font-normal text-muted-foreground">
                    ·{" "}
                    {tSafe(
                      `admin.onlineStoreThemePage.themes.${active.id}.name`,
                      active.name,
                    )}
                  </span>
                </CardTitle>
                <CardDescription>
                  {tSafe(
                    "admin.themeSettings.launchDescription",
                    "Colors, typography, layout, shapes and buttons for the active theme, edited beside a live preview of your store. Saved per theme — switching themes switches to that theme's own settings.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href={`/${locale}/admin/online-store/theme/editor`}>
                    {tSafe("admin.themeSettings.launch", "Open theme editor")}
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={pendingTheme !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingTheme(null);
            setStarterMode("publish");
          }
        }}
        title={tSafe(
          "admin.themeSettings.activateTitle",
          "Switch the storefront theme?",
        )}
        description={tSafe(
          "admin.themeSettings.activateDescription",
          "Each theme keeps its own settings, so switching back later loses nothing. Choose below what happens to your page layouts.",
        )}
        confirmText={tSafe("admin.onlineStoreThemePage.activate", "Use this theme")}
        loading={activating}
        onConfirm={() => {
          if (pendingTheme) void activate(pendingTheme, starterMode);
        }}
      >
        {manifests.find((manifest) => manifest.id === pendingTheme)
          ?.hasStarter ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            {(
              [
                {
                  value: "publish",
                  label: tSafe(
                    "admin.themeSettings.starterPublish",
                    "Use the theme's starter layout (recommended)",
                  ),
                  hint: tSafe(
                    "admin.themeSettings.starterPublishHint",
                    "Your storefront changes right away, with the theme's sections bound to your own collections and products. Your previous layout is kept in Version history.",
                  ),
                },
                {
                  value: "draft",
                  label: tSafe(
                    "admin.themeSettings.starterDraft",
                    "Load the starter into my home draft only",
                  ),
                  hint: tSafe(
                    "admin.themeSettings.starterDraftHint",
                    "Shoppers see nothing until you publish it from Customize.",
                  ),
                },
                {
                  value: "keep",
                  label: tSafe(
                    "admin.themeSettings.starterKeep",
                    "Keep my current layout",
                  ),
                  hint: tSafe(
                    "admin.themeSettings.starterKeepHint",
                    "Only the design changes. All pages stay as they are.",
                  ),
                },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5"
              >
                <input
                  type="radio"
                  name="theme-starter"
                  className="mt-1 accent-[var(--primary)]"
                  checked={starterMode === option.value}
                  onChange={() => setStarterMode(option.value)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
