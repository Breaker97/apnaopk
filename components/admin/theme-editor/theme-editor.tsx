"use client";

import { useEffect, useMemo, useState } from "react";
import { useLastValidValue } from "@/hooks/use-last-valid-value";
import Link from "@/components/language/link";
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  Loader2,
  Moon,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast-notification";
import { ColorRoleRow, type ColorIssue } from "@/components/admin/theme-editor/color-role-row";
import { KeyColorsEditor, type PaletteChoice } from "@/components/admin/theme-editor/key-colors-editor";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { useAppSettings } from "@/stores/app-settings";
import { BRAND_SAVE_KEYS, brandFingerprint, pickBrand } from "@/lib/theme-colors/brand";
import type { KeyColorTrio } from "@/lib/theme-colors/palettes";
import { ThemePreviewPane } from "@/components/admin/online-store/theme-preview-pane";
import {
  createTSafe,
  type TSafe,
} from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { parseColor } from "@/lib/theme-colors/color";
import { schemeDiagnostics } from "@/lib/theme-colors/diagnostics";
import { normalizeColorToHex } from "@/lib/site-config/appearance-colors";
import {
  canonicalizeThemeColors,
  resolveThemeSchemes,
  type BrandColors,
} from "@/lib/storefront/themes/compile";
import {
  normalizeThemeTokens,
  ADVANCED_COLOR_SECTIONS,
  BRAND_COLOR_REFS,
  COLOR_ROLE_SECTIONS,
  COLOR_ROLES,
  KEY_COLOR_META,
  ROLE_TEXT_ROLES,
  THEME_TOKEN_GROUPS,
  type ColorRole,
  type ColorScheme,
  type KeyColorRole,
  type ThemeGroupKey,
  type ThemeTokens,
  type TokenField,
  isFieldVisible,
} from "@/lib/storefront/themes/tokens";
import { cn } from "@/lib/utils";
import {
  ColorControl,
  FontControl,
  LengthControl,
  PictureControl,
  SegmentedControl,
  SelectControl,
} from "./token-controls";

const EMPTY_SCHEME = Object.fromEntries(
  COLOR_ROLES.map((role) => [role, ""]),
) as ColorScheme;

/**
 * The theme editor: a group tab strip over two panes — controls generated
 * from the token schema, and the live storefront — for the ACTIVE theme's
 * tokens. Nothing here knows what a token means; `THEME_TOKEN_GROUPS`
 * decides the control, `compileTheme` decides the CSS, and the preview
 * bridge runs that same compiler in the frame.
 *
 * Every colour here, the key colours included, is this theme's own (colour
 * schema 4): `defaults` are the theme's own (`ownKeyColorDefaults`), and the
 * save mirrors the key colours into the store brand the dashboards read.
 */
export function ThemeEditor({
  locale,
  themeId,
  themeName,
  defaults,
  initialTokens,
  brand,
  initialVersions,
  samplePath,
}: {
  initialVersions: {themeValues:string;brandColors:string};
  /** A real product page for the preview's page switcher; absent when the
   * store has no product a shopper can see. */
  samplePath?: string;
  locale: string;
  themeId: string;
  themeName: string;
  defaults: ThemeTokens;
  initialTokens: ThemeTokens;
  brand: BrandColors;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [saved, setSaved] = useState(initialTokens);
  const [tokens, setTokens] = useState(initialTokens);
  /**
   * The store brand (`appearance.*`): the LIVE theme's key colours, mirrored
   * by the server on every save, plus the palette library shared by every
   * theme. Only the library is edited here (Save as palette); it rides the
   * same Save as the theme's colours.
   */
  const { settings: liveSettings, savedSettings, commitSavedPaths, rebaseSavedPaths, discardOwnedPaths, setPanelUnsaved } = useAdminSettingsContext();
  const [versions,setVersions] = useState(initialVersions);
  const brandDirty = brandFingerprint(liveSettings?.appearance, normalizeColorToHex) !== brandFingerprint(savedSettings?.appearance, normalizeColorToHex);
  // Keyed on the theme so a switch elsewhere never edits stale tokens.
  const storageKey = `theme-editor:${themeId}`;
  const [group, setGroup] = useState<ThemeGroupKey>("colors");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [saving, setSaving] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  // Below xl the preview replaces the controls instead of sitting beside them.
  const [showPreview, setShowPreview] = useState(false);
  // The key colour the preview marks while its tile is pointed at or open.
  const [highlight, setHighlight] = useState<KeyColorRole | null>(null);

  const tokensDirty = useMemo(
    () => JSON.stringify(tokens) !== JSON.stringify(saved),
    [tokens, saved],
  );
  const dirty = tokensDirty || brandDirty;
  useEffect(() => {setPanelUnsaved("theme-editor",tokensDirty);return () => setPanelUnsaved("theme-editor",false);},[tokensDirty,setPanelUnsaved]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  /**
   * The brand the compiler is handed. A theme with its own key colours
   * (schema 4) never paints with it; the preview protocol still carries one,
   * so it is the stored brand, or the server's for anything unreadable.
   */
  const appearance=liveSettings?.appearance;
  const liveBrand = useLastValidValue<BrandColors>({
    primary:appearance?.primaryColor ?? brand.primary,
    secondary:appearance?.secondaryColor ?? brand.secondary,
    accent:appearance?.accentColor ?? brand.accent,
    skeleton:appearance?.skeletonColor ?? brand.skeleton ?? "",
  },brand,(input,previous)=>({
    primary:normalizeColorToHex(input.primary) ?? previous.primary,
    secondary:normalizeColorToHex(input.secondary) ?? previous.secondary,
    accent:normalizeColorToHex(input.accent) ?? previous.accent,
    skeleton:input.skeleton === "" ? "" : normalizeColorToHex(input.skeleton) ?? previous.skeleton,
  }));
  const previewTokens = useLastValidValue(tokens,initialTokens,(input,previous)=>{
    const next=structuredClone(input);
    for (const mode of ["light","dark"] as const) for (const role of COLOR_ROLES) {
      const raw=next.colors[mode][role];
      if (!raw || BRAND_COLOR_REFS.includes(raw as typeof BRAND_COLOR_REFS[number])) continue;
      const normalized=normalizeColorToHex(raw);
      if (!normalized) next.colors[mode][role]=previous.colors[mode][role];
      else if (!((parseColor(raw)?.a ?? 1)<1 && raw === saved.colors[mode][role])) next.colors[mode][role]=normalized;
    }
    return next;
  });
  const schemes = useMemo(() => resolveThemeSchemes(previewTokens, liveBrand),[previewTokens,liveBrand]);
  // The key colours as this theme paints them (light) — what the dashboards
  // are painted with once saved, and what a dashboard page opened in the
  // preview frame follows while they are unsaved.
  const keyColors = useMemo(
    () => ({ primary: schemes.light.primary, secondary: schemes.light.secondary, accent: schemes.light.accent }),
    [schemes],
  );
  // The apparent sidebar is painted with them: it follows a palette as it is
  // picked, and goes back with Discard. (Only the sidebar — the editor's own
  // buttons stay as they are.)
  const { primary: previewPrimary, secondary: previewSecondary } = keyColors;
  useEffect(() => {
    useAppSettings.getState().setPreviewBrand(tokensDirty ? { primaryColor: previewPrimary, secondaryColor: previewSecondary } : null);
  }, [tokensDirty, previewPrimary, previewSecondary]);
  useEffect(() => () => useAppSettings.getState().setPreviewBrand(null), []);
  // The theme's own default key colours, for its palette chip.
  const themeDefaults = useMemo<KeyColorTrio>(() => {
    const light = resolveThemeSchemes(defaults, liveBrand).light;
    return { primary: light.primary, secondary: light.secondary, accent: light.accent };
  }, [defaults, liveBrand]);

  const setField = (groupKey: ThemeGroupKey, key: string, value: unknown) => {
    setTokens((current) => ({
      ...current,
      [groupKey]: { ...current[groupKey], [key]: value },
    }));
  };

  const setColor = (role: ColorRole, value: string) => {
    setTokens((current) => {
      if (mode === "light") {
        return {
          ...current,
          colors: {
            ...current.colors,
            light: { ...current.colors.light, [role]: value },
          },
        };
      }
      // Dark keeps only the colours set FOR dark; every other role follows
      // light. Coming from "auto", whatever the dark scheme still holds was
      // being ignored — start clean rather than revive it.
      const base =
        current.colors.darkMode === "custom" ? current.colors.dark : EMPTY_SCHEME;
      const dark = { ...base, [role]: value };
      const overridden = COLOR_ROLES.some((entry) => dark[entry]);
      return {
        ...current,
        colors: {
          ...current.colors,
          dark: overridden ? dark : { ...EMPTY_SCHEME },
          darkMode: overridden ? "custom" : "auto",
        },
      };
    });
  };

  // A palette sets the light primary, secondary and accent at once; dark
  // follows light again for the three, so it reaches dark mode too. A
  // palette without a secondary (saved by the old two-colour editor) leaves
  // Add to cart as it is.
  const applyPalette = (palette: PaletteChoice) => {
    setTokens((current) => {
      const light = { ...current.colors.light };
      const dark = { ...current.colors.dark };
      for (const role of ["primary", "secondary", "accent"] as const) {
        const next = palette === "default" ? defaults.colors.light[role] : palette[role] ? normalizeColorToHex(palette[role]) : null;
        if (next === null || next === undefined) continue;
        light[role] = next;
        dark[role] = "";
      }
      const overridden = current.colors.darkMode === "custom" && COLOR_ROLES.some((role) => dark[role]);
      return {
        ...current,
        colors: {
          ...current.colors,
          light,
          dark: overridden ? dark : { ...EMPTY_SCHEME },
          darkMode: overridden ? "custom" : "auto",
        },
      };
    });
  };

  const resetGroup = (groupKey: ThemeGroupKey) => {
    setTokens((current) => ({
      ...current,
      [groupKey]: structuredClone(defaults[groupKey]),
    }));
  };

  type SavedResult = { values: ThemeTokens; brand: Partial<NonNullable<typeof liveSettings>["appearance"]>; versions: typeof versions; appearanceVersion: string; appearanceSnapshot?: NonNullable<typeof liveSettings>["appearance"]; warnings?: string[] };
  const acceptSaved = (result: SavedResult) => {
    setSaved(result.values);setTokens(result.values);setVersions(result.versions);
    commitSavedPaths(result.brand,result.appearanceVersion,result.appearanceSnapshot);
    for (const warning of result.warnings ?? []) toast.warning(warning);
  };
  const save = async () => {
    setSaving(true);
    try {
      const result = await apiClient.patch<SavedResult>(
        "/api/admin/theme-settings",
        {themeId, ...(tokensDirty ? {values:tokens} : {}), ...(brandDirty ? {brandPatch:pickBrand(liveSettings?.appearance)} : {}), expected:versions},
      );
      acceptSaved(result);
      toast.success(tSafe("admin.themeEditor.saved", "Theme settings saved"));
    } catch (error) {
      // Someone else saved this theme (or the brand) since the editor loaded.
      // Their version becomes the baseline — Discard returns to it — and the
      // draft stays, so the next Save replaces theirs knowingly. Without this
      // every later Save re-sent the stale versions and failed the same way.
      if (error instanceof ApiClientError && error.status === 409) {
        try {
          const current = await apiClient.get<SavedResult & {theme:string}>("/api/admin/theme-settings");
          if (current.theme !== themeId) {
            toast.error(tSafe("admin.themeEditor.themeChanged", "Another theme was made active while you were editing. Reopen the editor for it."));
            return;
          }
          setSaved(current.values);
          setVersions(current.versions);
          rebaseSavedPaths(current.brand);
          toast.error(tSafe(
            "admin.themeEditor.conflictKeepDraft",
            "Someone else saved these settings while you were editing. Save again to replace their changes with yours, or Discard to load theirs.",
          ));
          return;
        } catch { /* Fall through to the server's own message. */ }
      }
      // A dropped response can happen after persistence. Reconcile before retrying.
      if (!(error instanceof ApiClientError) || error.status >= 500) {
        try {
          const current = await apiClient.get<SavedResult & {theme:string}>("/api/admin/theme-settings");
          const sameTokens = !tokensDirty || JSON.stringify(current.values) === JSON.stringify(canonicalizeThemeColors(normalizeThemeTokens(defaults,tokens),saved,liveBrand));
          // The brand's colours are the server's mirror of the theme; only
          // the palette library is the editor's own to compare.
          const sameBrand = !brandDirty || JSON.stringify(current.brand.customPresets ?? []) === JSON.stringify(pickBrand(liveSettings?.appearance).customPresets ?? []);
          if (current.theme === themeId && sameTokens && sameBrand) {acceptSaved(current);toast.success(tSafe("admin.themeEditor.saved","Theme settings saved"));return;}
        } catch { /* Keep the draft when persistence cannot be established. */ }
      }
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.themeEditor.saveFailed", "Saving failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const activeGroup =
    THEME_TOKEN_GROUPS.find((entry) => entry.key === group) ??
    THEME_TOKEN_GROUPS[0];
  const groupAtDefaults =
    JSON.stringify(tokens[activeGroup.key]) ===
    JSON.stringify(defaults[activeGroup.key]);

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[560px] flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/admin/online-store/theme">
            <ArrowLeft className="h-4 w-4" />
            {tSafe("admin.themeEditor.back", "Themes")}
          </Link>
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <h1 className="truncate text-sm font-semibold">
            {tSafe("admin.themeEditor.title", "Theme settings")}
            <span className="font-normal text-muted-foreground">
              {" "}
              · {themeName}
            </span>
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* On a phone only the dot shows; its state is still announced. */}
          <span
            role="status"
            className={cn(
              "flex items-center gap-1.5 text-xs",
              dirty
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                dirty ? "bg-amber-500" : "bg-emerald-500",
              )}
            />
            <span className="sr-only sm:not-sr-only">
              {dirty
                ? tSafe("admin.themeEditor.unsaved", "Unsaved changes")
                : tSafe("admin.themeEditor.allSaved", "All changes saved")}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="xl:hidden"
            aria-pressed={showPreview}
            onClick={() => setShowPreview((value) => !value)}
          >
            <Eye className="h-4 w-4" />
            {showPreview
              ? tSafe("admin.themeEditor.controls", "Settings")
              : tSafe("admin.themeEditor.preview", "Preview")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setConfirmResetAll(true)}
            className="gap-1.5 text-muted-foreground"
            // Icon-only below md: the label still names it.
            aria-label={tSafe("admin.themeEditor.resetAll", "Reset all to theme defaults")}
            title={tSafe("admin.themeEditor.resetAll", "Reset all to theme defaults")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden md:inline">
              {tSafe(
                "admin.themeEditor.resetAll",
                "Reset all to theme defaults",
              )}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => {setTokens(saved);discardOwnedPaths(BRAND_SAVE_KEYS);}}
            className="gap-1.5"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {tSafe("admin.themeEditor.discard", "Discard")}
          </Button>
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {tSafe("admin.themeEditor.save", "Save")}
          </Button>
        </div>
      </div>

      {/* Group tabs — one strip across the top instead of a third pane. */}
      <div
        role="tablist"
        aria-label={tSafe("admin.themeEditor.title", "Theme settings")}
        data-editor={storageKey}
        className={cn(
          "scrollbar-hide flex shrink-0 gap-1 overflow-x-auto border-b border-border/70 px-3",
          showPreview && "hidden xl:flex",
        )}
      >
        {THEME_TOKEN_GROUPS.map((entry) => {
          const selected = entry.key === group;
          const changed =
            JSON.stringify(tokens[entry.key]) !==
            JSON.stringify(defaults[entry.key]);
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setGroup(entry.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                selected
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tSafe(
                `admin.themeEditor.groups.${entry.key}.label`,
                entry.label,
              )}
              {changed ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-primary/60"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Panes: controls + preview */}
      <div
        className={cn(
          "grid min-h-0 flex-1",
          showPreview
            ? "grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)]"
            : "grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)]",
        )}
      >
        {/* Controls */}
        <div
          className={cn(
            "flex min-h-0 flex-col border-r border-border/70",
            showPreview && "hidden xl:flex",
          )}
        >
          <div className="border-b border-border/70 px-4 py-3">
            <h2 className="text-sm font-semibold">
              {tSafe(
                `admin.themeEditor.groups.${activeGroup.key}.label`,
                activeGroup.label,
              )}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tSafe(
                `admin.themeEditor.groups.${activeGroup.key}.description`,
                activeGroup.description,
                // Colors names the theme they belong to.
                { theme: themeName },
              )}
            </p>
          </div>
          <fieldset disabled={saving} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {activeGroup.key === "colors" ? (
              <ColorsGroup
                tokens={tokens}
                defaults={defaults}
                themeName={themeName}
                themeDefaults={themeDefaults}
                mode={mode}
                setMode={setMode}
                schemes={schemes}
                setColor={setColor}
                onApplyPalette={applyPalette}
                onHighlight={setHighlight}
                tSafe={tSafe}
              />
            ) : (
              activeGroup.fields
                .filter((field) =>
                  isFieldVisible(
                    field,
                    tokens[activeGroup.key] as Record<string, unknown>,
                  ),
                )
                .map((field) => (
                  <GenericControl
                    key={field.key}
                    resolved={
                      field.resolvesTo
                        ? schemes[mode][field.resolvesTo]
                        : String(
                            (tokens[activeGroup.key] as Record<string, unknown>)[
                              field.key
                            ] ?? "",
                          ) || "transparent"
                    }
                    field={field}
                    value={
                      (tokens[activeGroup.key] as Record<string, unknown>)[
                        field.key
                      ]
                    }
                    onChange={(value) =>
                      setField(activeGroup.key, field.key, value)
                    }
                    tSafe={tSafe}
                  />
                ))
            )}
          </fieldset>
          <div className="border-t border-border/70 px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={groupAtDefaults || saving}
              onClick={() => resetGroup(activeGroup.key)}
              className="gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {activeGroup.key === "colors" ? tSafe("admin.themeEditor.resetColors", "Reset theme colors") : tSafe("admin.themeEditor.resetGroup", "Reset group")}
            </Button>
          </div>
        </div>

        {/* Preview */}
        <ThemePreviewPane
          locale={locale}
          themeId={themeId}
          brand={liveBrand}
          previewMode={mode}
          keyColors={keyColors}
          highlight={activeGroup.key === "colors" ? highlight : null}
          highlightLabel={highlight ? tSafe(`admin.themeEditor.keyColors.${highlight}.label`, KEY_COLOR_META[highlight].label) : undefined}
          samplePath={samplePath}
          tokens={previewTokens}
          tSafe={tSafe}
          className={cn("p-3", !showPreview && "hidden xl:flex")}
        />
      </div>

      <ConfirmDialog
        open={confirmResetAll}
        onOpenChange={setConfirmResetAll}
        title={tSafe("admin.themeEditor.resetAllTitle", "Reset every setting?")}
        description={tSafe(
          "admin.themeEditor.resetAllDescriptionTheme",
          "Every group, colors included, goes back to {theme}’s own defaults. Your other themes are not touched. Nothing is saved until you press Save.",
          { theme: themeName },
        )}
        cancelText={tSafe("common.cancel", "Cancel")}
        confirmText={tSafe(
          "admin.themeEditor.resetAll",
          "Reset all to theme defaults",
        )}
        onConfirm={() => {
          setTokens(structuredClone(defaults));
          setConfirmResetAll(false);
        }}
      />
    </div>
  );
}

function GenericControl({
  field,
  value,
  onChange,
  resolved,
  tSafe,
}: {
  field: TokenField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** For a colour token: what its empty value actually paints. */
  resolved: string;
  tSafe: TSafe;
}) {
  switch (field.kind) {
    case "length":
      return (
        <LengthControl
          field={field}
          value={value === "" ? "" : Number(value)}
          onChange={onChange}
        />
      );
    case "font":
      return (
        <FontControl
          field={field}
          value={String(value ?? "")}
          onChange={onChange}
          tSafe={tSafe}
        />
      );
    case "select":
      return (
        <SelectControl
          field={field}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
    case "segmented":
      return (
        <SegmentedControl
          field={field}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
    case "picture":
      return (
        <PictureControl
          field={field}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
    case "color":
      return (
        <ColorControl
          field={field}
          value={String(value ?? "")}
          onChange={onChange}
          resolved={resolved}
          tSafe={tSafe}
        />
      );
  }
}

function ColorsGroup({
  tokens,
  defaults,
  themeName,
  themeDefaults,
  mode,
  setMode,
  schemes,
  setColor,
  onApplyPalette,
  onHighlight,
  tSafe,
}: {
  tokens: ThemeTokens;
  defaults: ThemeTokens;
  themeName: string;
  themeDefaults: KeyColorTrio;
  mode: "light" | "dark";
  setMode: (mode: "light" | "dark") => void;
  schemes: ReturnType<typeof resolveThemeSchemes>;
  setColor: (role: ColorRole, value: string) => void;
  onApplyPalette: (palette: PaletteChoice) => void;
  onHighlight: (role: KeyColorRole | null) => void;
  tSafe: TSafe;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const resolved = schemes[mode];
  // Light stores every role; dark stores only the colours set for dark (its
  // custom mode), everything else following light.
  const values =
    mode === "light"
      ? tokens.colors.light
      : tokens.colors.darkMode === "custom"
        ? tokens.colors.dark
        : EMPTY_SCHEME;
  const roleDefaults = mode === "light" ? defaults.colors.light : EMPTY_SCHEME;
  const failing = schemeDiagnostics(resolved).filter((d) => d.passes === false);
  // One warning per colour — its weakest pair — rather than one line for
  // every surface it sits on.
  const issuesFor = (role: ColorRole): ColorIssue[] => {
    const worst = new Map<ColorRole, ColorIssue>();
    for (const d of failing) {
      // A failing pair shows on both of its rows: the colour that is hard to
      // read, and the surface it is hard to read on — the one a merchant may
      // just have changed (a dark band turns every link on it unreadable).
      if (d.role !== role && d.against !== role && !(ROLE_TEXT_ROLES[role] ?? []).includes(d.role)) continue;
      const seen = worst.get(d.role);
      if (!seen || (d.ratio ?? 0) < (seen.ratio ?? 0)) worst.set(d.role, d);
    }
    return [...worst.values()];
  };
  const darkOwnFor = (role: ColorRole) =>
    mode === "light" && tokens.colors.darkMode === "custom"
      ? tokens.colors.dark[role] || undefined
      : undefined;
  const advancedRoles = ADVANCED_COLOR_SECTIONS.flatMap((section) => section.roles);
  const advancedNeedsLook = advancedRoles.some((role) => issuesFor(role).length > 0);

  const rows = (sections: typeof COLOR_ROLE_SECTIONS, firstHeadingBorder: boolean) =>
    sections.map((section, index) => (
      <div key={section.key} role="group" aria-label={tSafe(`admin.themeEditor.sections.${section.key}`, section.label)}>
        <p
          className={cn(
            "px-3 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-muted-foreground",
            index === 0 && !firstHeadingBorder ? "pt-2.5" : "border-t border-border pt-3",
          )}
        >
          {tSafe(`admin.themeEditor.sections.${section.key}`, section.label)}
        </p>
        {section.roles.map((role, roleIndex) => (
          <ColorRoleRow
            key={`${mode}-${role}`}
            role={role}
            mode={mode}
            value={values[role]}
            defaultValue={roleDefaults[role]}
            values={values}
            defaults={roleDefaults}
            resolved={resolved}
            issues={issuesFor(role)}
            onChange={setColor}
            first={roleIndex === 0}
            darkOwn={darkOwnFor(role)}
            tSafe={tSafe}
          />
        ))}
      </div>
    ));

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex h-6 min-w-0 items-center rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground">
          <span className="truncate">
            {tSafe("admin.themeEditor.themeOnly", "{theme} only", { theme: themeName })}
          </span>
        </span>
        <div
          role="radiogroup"
          aria-label={tSafe("admin.themeEditor.colorMode", "Color mode")}
          className="inline-flex shrink-0 rounded-[10px] border border-border bg-muted/60 p-0.5"
        >
          {(["light", "dark"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={mode === entry}
              onClick={() => setMode(entry)}
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-[8px] px-2.5 text-xs font-medium transition-colors",
                mode === entry
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry === "light" ? (
                <Sun className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Moon className="h-3.5 w-3.5" aria-hidden />
              )}
              {entry === "light"
                ? tSafe("admin.themeEditor.modeLight", "Light")
                : tSafe("admin.themeEditor.modeDark", "Dark")}
            </button>
          ))}
        </div>
      </div>

      {mode === "dark" ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {tSafe(
            "admin.themeEditor.darkFollows",
            "Dark follows your light colors automatically. Click a color to set it only for dark.",
          )}
        </p>
      ) : null}

      <KeyColorsEditor
        themeName={themeName}
        mode={mode}
        values={values}
        defaults={roleDefaults}
        resolved={resolved}
        themeDefaults={themeDefaults}
        issuesFor={issuesFor}
        darkOwnFor={darkOwnFor}
        onChange={setColor}
        onApplyPalette={onApplyPalette}
        onHighlight={onHighlight}
        tSafe={tSafe}
      />

      <section className="space-y-2" aria-labelledby="theme-colors-title">
        <h3 id="theme-colors-title" className="text-[13px] font-semibold">
          {tSafe("admin.themeEditor.moreColors", "More colors")}
        </h3>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {rows(COLOR_ROLE_SECTIONS, false)}
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex min-h-[46px] w-full items-center gap-2.5 border-t border-border bg-muted/30 px-3 py-1.5 text-start transition-colors hover:bg-muted/50"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-medium">
                {tSafe("admin.themeEditor.advancedColors", "Advanced")}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {tSafe("admin.themeEditor.advancedHintStates", "Hover, selection, focus, sale background")}
              </span>
            </span>
            {advancedNeedsLook ? (
              <span
                role="img"
                aria-label={tSafe("admin.themeEditor.advancedLowContrast", "A color here is hard to read")}
                className="h-2 w-2 shrink-0 rounded-full bg-status-on-warning"
              />
            ) : null}
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", advancedOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          {advancedOpen ? rows(ADVANCED_COLOR_SECTIONS, true) : null}
        </div>
      </section>
    </>
  );
}
