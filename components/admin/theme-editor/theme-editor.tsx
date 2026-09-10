"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  Loader2,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { ThemePreviewPane } from "@/components/admin/online-store/theme-preview-pane";
import {
  createTSafe,
  type TSafe,
} from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import {
  resolveThemeSchemes,
  type BrandColors,
} from "@/lib/storefront/themes/compile";
import {
  COLOR_ROLES,
  THEME_TOKEN_GROUPS,
  type ColorRole,
  type ThemeGroupKey,
  type ThemeTokens,
  type TokenField,
  type TokenGroup,
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

/** Which surface each text-like role is read against, for the AA badge. */
const CONTRAST_AGAINST: Partial<Record<ColorRole, ColorRole>> = {
  text: "background",
  textMuted: "background",
  link: "background",
  onPrimary: "primary",
  onSecondary: "secondary",
  border: "background",
};

/**
 * The theme editor: a group tab strip over two panes — controls generated
 * from the token schema, and the live storefront — for the ACTIVE theme's
 * tokens. Nothing here knows what a token means; `THEME_TOKEN_GROUPS`
 * decides the control, `compileTheme` decides the CSS, and the preview
 * bridge runs that same compiler in the frame.
 */
export function ThemeEditor({
  locale,
  themeId,
  themeName,
  defaults,
  initialTokens,
  brand,
}: {
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
  // Keyed on the theme so a switch elsewhere never edits stale tokens.
  const storageKey = `theme-editor:${themeId}`;
  const [group, setGroup] = useState<ThemeGroupKey>("colors");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [saving, setSaving] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  // Below xl the preview replaces the controls instead of sitting beside them.
  const [showPreview, setShowPreview] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(tokens) !== JSON.stringify(saved),
    [tokens, saved],
  );

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const schemes = useMemo(
    () => resolveThemeSchemes(tokens, brand),
    [tokens, brand],
  );

  const setField = (groupKey: ThemeGroupKey, key: string, value: unknown) => {
    setTokens((current) => ({
      ...current,
      [groupKey]: { ...current[groupKey], [key]: value },
    }));
  };

  const setColor = (role: ColorRole, value: string) => {
    setTokens((current) => ({
      ...current,
      colors: {
        ...current.colors,
        [mode]: { ...current.colors[mode], [role]: value },
      },
    }));
  };

  const resetGroup = (groupKey: ThemeGroupKey) => {
    setTokens((current) => ({
      ...current,
      [groupKey]: structuredClone(defaults[groupKey]),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await apiClient.patch<{ values: ThemeTokens }>(
        "/api/admin/theme-settings",
        { values: tokens },
      );
      setSaved(result.values);
      setTokens(result.values);
      toast.success(tSafe("admin.themeEditor.saved", "Theme settings saved"));
    } catch (error) {
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
          <Link href={`/${locale}/admin/online-store/theme`}>
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
          <span
            className={cn(
              "hidden items-center gap-1.5 text-xs sm:flex",
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
            {dirty
              ? tSafe("admin.themeEditor.unsaved", "Unsaved changes")
              : tSafe("admin.themeEditor.allSaved", "All changes saved")}
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
            onClick={() => setConfirmResetAll(true)}
            className="gap-1.5 text-muted-foreground"
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
            onClick={() => setTokens(saved)}
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
              )}
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {activeGroup.key === "colors" ? (
              <ColorsGroup
                group={activeGroup}
                tokens={tokens}
                mode={mode}
                setMode={setMode}
                schemes={schemes}
                brand={brand}
                setColor={setColor}
                setDarkMode={(value) =>
                  setTokens((current) => ({
                    ...current,
                    colors: { ...current.colors, darkMode: value },
                  }))
                }
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
          </div>
          <div className="border-t border-border/70 px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={groupAtDefaults}
              onClick={() => resetGroup(activeGroup.key)}
              className="gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {tSafe("admin.themeEditor.resetGroup", "Reset group")}
            </Button>
          </div>
        </div>

        {/* Preview */}
        <ThemePreviewPane
          locale={locale}
          tokens={tokens}
          tSafe={tSafe}
          className={cn("p-3", !showPreview && "hidden xl:flex")}
        />
      </div>

      <ConfirmDialog
        open={confirmResetAll}
        onOpenChange={setConfirmResetAll}
        title={tSafe("admin.themeEditor.resetAllTitle", "Reset every setting?")}
        description={tSafe(
          "admin.themeEditor.resetAllDescription",
          "Every group goes back to the theme’s own defaults. Nothing is saved until you press Save.",
        )}
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
  tSafe,
}: {
  field: TokenField;
  value: unknown;
  onChange: (value: unknown) => void;
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
      return null;
  }
}

function ColorsGroup({
  group,
  tokens,
  mode,
  setMode,
  schemes,
  brand,
  setColor,
  setDarkMode,
  tSafe,
}: {
  group: TokenGroup;
  tokens: ThemeTokens;
  mode: "light" | "dark";
  setMode: (mode: "light" | "dark") => void;
  schemes: ReturnType<typeof resolveThemeSchemes>;
  brand: BrandColors;
  setColor: (role: ColorRole, value: string) => void;
  setDarkMode: (value: "auto" | "custom") => void;
  tSafe: TSafe;
}) {
  const darkAuto = tokens.colors.darkMode === "auto";
  const editable = mode === "light" || !darkAuto;
  const resolved = schemes[mode];

  return (
    <>
      <div
        role="radiogroup"
        className="flex rounded-md border border-border p-0.5"
      >
        {(["light", "dark"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={mode === entry}
            onClick={() => setMode(entry)}
            className={cn(
              "flex-1 rounded-sm px-2 py-1 text-xs transition-colors",
              mode === entry
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry === "light"
              ? tSafe("admin.themeEditor.modeLight", "Light")
              : tSafe("admin.themeEditor.modeDark", "Dark")}
          </button>
        ))}
      </div>

      {mode === "dark" ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p>
            {darkAuto
              ? tSafe(
                  "admin.themeEditor.darkAuto",
                  "Dark mode is derived from your light colors.",
                )
              : tSafe(
                  "admin.themeEditor.darkCustom",
                  "Dark mode has its own colors.",
                )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={() => setDarkMode(darkAuto ? "custom" : "auto")}
          >
            {darkAuto
              ? tSafe("admin.themeEditor.darkEdit", "Edit dark separately")
              : tSafe(
                  "admin.themeEditor.darkBackToAuto",
                  "Derive from light again",
                )}
          </Button>
        </div>
      ) : null}

      {/* A strip of the whole scheme as it resolves — the fastest read of
          whether the palette holds together. */}
      <div className="flex h-6 overflow-hidden rounded-md border border-border">
        {COLOR_ROLES.map((role) => (
          <span
            key={role}
            title={role}
            className="flex-1"
            style={{ backgroundColor: resolved[role] }}
          />
        ))}
      </div>

      <div
        className={cn(
          "space-y-4",
          !editable && "pointer-events-none opacity-50",
        )}
      >
        {group.fields.map((field) => {
          const role = field.key as ColorRole;
          const against = CONTRAST_AGAINST[role];
          return (
            <ColorControl
              key={`${mode}-${role}`}
              field={field}
              value={tokens.colors[mode][role]}
              onChange={(value) => setColor(role, value)}
              brand={brand}
              resolved={resolved[role]}
              against={against ? resolved[against] : undefined}
              tSafe={tSafe}
            />
          );
        })}
      </div>
    </>
  );
}
