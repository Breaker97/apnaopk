"use client";

import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ColorPickerPanel } from "@/components/admin/sliders/color-picker";
import { ColorSwatchPicker } from "@/components/admin/color-swatch-picker";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { contrastRatio } from "@/lib/theme-colors/contrast";
import { readableTone } from "@/lib/theme-colors/derive";
import { schemeDiagnostics } from "@/lib/theme-colors/diagnostics";
import { normalizeColorToHex } from "@/lib/site-config/appearance-colors";
import {
  COLOR_ROLE_META,
  ROLE_TEXT_ROLES,
  type ColorRole,
} from "@/lib/storefront/themes/tokens";
import { cn } from "@/lib/utils";

/** One failing contrast pair, as `schemeDiagnostics` reports it. */
export interface ColorIssue {
  role: ColorRole;
  against: ColorRole;
  ratio: number | null;
  minimum: number;
}

// A theme's colours are its own (colour schema 4): a role is the theme's
// default or a colour the merchant chose, never a reference to a store-wide
// brand that would carry one theme's choice into the others.
type Source = "default" | "custom";

/** Where a value comes from, as the row and its editor present it. */
function sourceOf(value: string, defaultValue: string): Source {
  return value === defaultValue ? "default" : "custom";
}

/** The role's name, through i18n with the schema's English as fallback. */
export function roleLabel(role: ColorRole, tSafe: TSafe): string {
  return tSafe(`admin.themeEditor.colorRoles.${role}.label`, COLOR_ROLE_META[role].label);
}

function roleHint(role: ColorRole, tSafe: TSafe): string {
  return tSafe(`admin.themeEditor.colorRoles.${role}.hint`, COLOR_ROLE_META[role].hint);
}

function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(15_23_42/0.12)]",
        className,
      )}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * One theme colour: a row that names the colour and where it comes from,
 * and opens an editor in place. The list stays calm — a swatch, a plain
 * name, a source — and everything a merchant only needs while changing the
 * colour (the picker, what it is used for, the text that sits on it, a
 * contrast warning) lives in the editor.
 *
 * `value` is what is stored for THIS mode; `defaultValue` is what "theme
 * default" stores (the manifest's own value in light, "" — follow light —
 * in dark).
 */
export function ColorRoleRow({
  role,
  mode,
  value,
  defaultValue,
  values,
  defaults,
  resolved,
  issues,
  onChange,
  first,
  darkOwn,
  tSafe,
}: {
  role: ColorRole;
  mode: "light" | "dark";
  value: string;
  defaultValue: string;
  /** On the light tab: the colour this role keeps for dark mode, if it has
   *  one of its own — it then no longer follows the light colour. */
  darkOwn?: string;
  /** The stored values of this mode, for the row's text colours. */
  values: Record<ColorRole, string>;
  defaults: Record<ColorRole, string>;
  /** The scheme as it resolves (what paints), for swatches and contrast. */
  resolved: Record<ColorRole, string>;
  /** Failing contrast pairs of this role and of the text that sits on it. */
  issues: ColorIssue[];
  onChange: (role: ColorRole, value: string) => void;
  /** First row under a heading: no hairline above it. */
  first?: boolean;
  tSafe: TSafe;
}) {
  const [open, setOpen] = useState(false);
  const dark = mode === "dark";
  const label = roleLabel(role, tSafe);
  const source = sourceOf(value, defaultValue);

  const summary =
    source === "custom" ? (
      <span className="tabular-nums text-foreground">
        {(normalizeColorToHex(value) ?? value).toUpperCase()}
      </span>
    ) : dark ? (
      tSafe("admin.themeEditor.sourceAuto", "Auto")
    ) : (
      tSafe("admin.themeEditor.sourceDefault", "Theme default")
    );

  const issueText = issueSummary(role, issues, resolved, tSafe);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-11 w-full items-center gap-2.5 px-3 py-1.5 text-start transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
            !first && "border-t border-border/50",
            open && "bg-selection hover:bg-selection",
          )}
        >
          <Swatch color={resolved[role]} className="h-[22px] w-[22px]" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] text-foreground">{label}</span>
            {role === "accent" || role === "sale" ? (
              <span className="truncate text-[11px] text-muted-foreground">
                {role === "accent"
                  ? tSafe("admin.themeEditor.accentUse", "Featured & menu labels")
                  : tSafe("admin.themeEditor.saleUse", "Discounts & sale prices")}
              </span>
            ) : null}
          </span>
          {issues.length > 0 ? (
            <span
              role="img"
              aria-label={issueText}
              title={issueText}
              className="h-2 w-2 shrink-0 rounded-full bg-status-on-warning"
            />
          ) : null}
          <span className="shrink-0 text-xs text-muted-foreground">{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className="w-[340px] max-w-[calc(100vw-24px)] space-y-3.5 p-3.5"
        aria-label={roleLabel(role, tSafe)}
        // Focus lands on the chosen source, not on the hex field (which would
        // open a phone's keyboard) — and not left on the row, where Tab would
        // leave the editor and close it.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget as HTMLElement | null;
          content?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
        }}
      >
        <ColorRoleEditor
          role={role}
          mode={mode}
          value={value}
          defaultValue={defaultValue}
          values={values}
          defaults={defaults}
          resolved={resolved}
          issues={issues}
          onChange={onChange}
          onClose={() => setOpen(false)}
          darkOwn={darkOwn}
          tSafe={tSafe}
        />
      </PopoverContent>
    </Popover>
  );
}

/** A colour's weakest contrast pair as one line, for its warning dot. */
export function issueSummary(
  role: ColorRole,
  issues: ColorIssue[],
  resolved: Record<ColorRole, string>,
  tSafe: TSafe,
): string {
  if (issues.length === 0) return "";
  const [issue] = issues;
  return `${issue.role !== role ? `${roleLabel(issue.role, tSafe)}: ` : ""}${describeIssue(issue, resolved, tSafe)}`;
}

/** "Hard to see on Cards & menus (1.2:1)" — the worst pair, in words. */
function describeIssue(
  issue: ColorIssue,
  resolved: Record<ColorRole, string>,
  tSafe: TSafe,
): string {
  const ratio = issue.ratio ?? contrastRatio(resolved[issue.role], resolved[issue.against]);
  return tSafe(
    "admin.themeEditor.lowContrastOn",
    "Hard to see on {surface} ({ratio}:1). Aim for {minimum}:1.",
    {
      // As translated: lower-casing breaks languages that capitalise nouns.
      surface: roleLabel(issue.against, tSafe),
      ratio: ratio.toFixed(1),
      minimum: String(issue.minimum),
    },
  );
}

/**
 * Everything a merchant needs while changing one colour: where it comes
 * from, the picker, what it paints, the text that sits on it and a contrast
 * warning. Opened from a role row, and from a key-colour tile with its own
 * `title` and `defaultLabel` ("Electronics default").
 */
export function ColorRoleEditor({
  role,
  mode,
  value,
  defaultValue,
  values,
  defaults,
  resolved,
  issues,
  onChange,
  onClose,
  darkOwn,
  title,
  defaultLabel,
  tSafe,
}: {
  darkOwn?: string;
  role: ColorRole;
  mode: "light" | "dark";
  value: string;
  defaultValue: string;
  values: Record<ColorRole, string>;
  defaults: Record<ColorRole, string>;
  resolved: Record<ColorRole, string>;
  issues: ColorIssue[];
  onChange: (role: ColorRole, value: string) => void;
  onClose: () => void;
  /** The editor's heading; the role's own name when absent. */
  title?: string;
  /** What the light "default" source is called; "Theme default" when absent. */
  defaultLabel?: string;
  tSafe: TSafe;
}) {
  const dark = mode === "dark";
  // "Custom" chosen while the colour still equals the default (a theme whose
  // default is a hex, such as Furniture): the picker must open all the same.
  const [customChosen, setCustomChosen] = useState(false);
  const source: Source =
    customChosen && value === defaultValue ? "custom" : sourceOf(value, defaultValue);
  const current = resolved[role];
  const textRoles = ROLE_TEXT_ROLES[role] ?? [];
  const ownIssues = issues.filter((issue) => issue.role === role);
  // The readable tone clears every surface the colour is checked against,
  // not only the weakest one the warning names.
  const fixable = ownIssues.length > 0
    ? readableTone(
        current,
        schemeDiagnostics(resolved)
          .filter((pair) => pair.role === role)
          .map((pair) => resolved[pair.against]),
        Math.max(...ownIssues.map((issue) => issue.minimum)),
      )
    : null;

  const setSource = (next: Source) => {
    if (next === source) return;
    setCustomChosen(next === "custom");
    if (next === "default") onChange(role, defaultValue);
    // Custom starts from what paints now, so nothing jumps.
    else onChange(role, normalizeColorToHex(current) ?? "#888888");
  };

  const sources: { key: Source; label: string }[] = [
    {
      key: "default",
      label: dark
        ? tSafe("admin.themeEditor.sourceAuto", "Auto")
        : defaultLabel ?? tSafe("admin.themeEditor.sourceDefault", "Theme default"),
    },
    { key: "custom", label: tSafe("admin.themeEditor.sourceCustom", "Custom") },
  ];

  return (
    <>
      <div className="flex items-center gap-2">
        <Swatch color={current} className="h-[18px] w-[18px] rounded-[5px]" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title ?? roleLabel(role, tSafe)}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7 text-muted-foreground"
          aria-label={tSafe("common.close", "Close")}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div
        role="radiogroup"
        aria-label={tSafe("admin.themeEditor.colorSource", "Color source")}
        className="grid grid-cols-2 rounded-[10px] border border-border bg-muted/60 p-0.5"
      >
        {sources.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={source === entry.key}
            // One tab stop for the group; arrows move between the sources.
            tabIndex={source === entry.key ? 0 : -1}
            onClick={() => setSource(entry.key)}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const index = sources.findIndex((option) => option.key === entry.key);
              const next = sources[(index + step + sources.length) % sources.length];
              setSource(next.key);
              const group = event.currentTarget.parentElement;
              requestAnimationFrame(() =>
                group?.querySelectorAll<HTMLElement>('[role="radio"]')[sources.indexOf(next)]?.focus(),
              );
            }}
            className={cn(
              "h-7 truncate rounded-[8px] px-1.5 text-xs font-medium transition-colors",
              source === entry.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {!dark && darkOwn ? (
        <p className="rounded-md bg-muted/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
          {tSafe(
            "admin.themeEditor.darkOwnHint",
            "Dark mode keeps its own colour here ({color}), so it does not follow this one. Change it on the Dark tab.",
            { color: darkOwn.toUpperCase() },
          )}
        </p>
      ) : null}

      {source === "default" ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {dark
            ? tSafe(
                "admin.themeEditor.autoDarkHint",
                "Follows your light colors, adjusted so it shows on a dark page.",
              )
            : tSafe(
                "admin.themeEditor.defaultHint",
                "The theme's own color, chosen to read well with the rest.",
              )}
        </p>
      ) : null}

      {source === "custom" ? (
        <ColorPickerPanel
          value={normalizeColorToHex(value) ?? normalizeColorToHex(current) ?? "#888888"}
          onChange={(hex) => onChange(role, normalizeColorToHex(hex) ?? hex)}
          alpha={false}
        />
      ) : null}

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {tSafe("admin.themeEditor.usedFor", "Used for")}
        </p>
        <p className="text-[12.5px] leading-snug">{roleHint(role, tSafe)}</p>
      </div>

      {textRoles.length > 0 ? (
        <div className="space-y-2 border-t border-border/70 pt-3">
          {textRoles.map((textRole) => (
            <TextOnRow
              key={textRole}
              role={textRole}
              fill={role}
              value={values[textRole]}
              defaultValue={defaults[textRole]}
              resolved={resolved}
              dark={dark}
              onChange={onChange}
              tSafe={tSafe}
            />
          ))}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="space-y-2 border-t border-border/70 pt-3">
          {issues.map((issue) => (
            <p key={`${issue.role}-${issue.against}`} className="flex items-start gap-2 text-[12.5px] leading-snug">
              <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-status-on-warning" />
              <span>
                {issue.role !== role ? `${roleLabel(issue.role, tSafe)}: ` : ""}
                {describeIssue(issue, resolved, tSafe)}
              </span>
            </p>
          ))}
          {fixable && fixable !== current ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-2 ps-1.5"
              onClick={() => onChange(role, fixable)}
            >
              <Swatch color={fixable} className="h-[18px] w-[18px] rounded-[5px]" />
              {tSafe("admin.themeEditor.useReadable", "Use {color}", { color: fixable.toUpperCase() })}
            </Button>
          ) : null}
        </div>
      ) : null}

      {source !== "default" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-muted-foreground"
          onClick={() => onChange(role, defaultValue)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {dark
            ? tSafe("admin.themeEditor.backToAuto", "Back to auto")
            : defaultLabel
              ? tSafe("admin.themeEditor.resetToNamed", "Back to {name}", { name: defaultLabel })
              : tSafe("admin.themeEditor.resetToDefault", "Reset to theme default")}
        </Button>
      ) : null}
    </>
  );
}

/**
 * The text that sits on a fill — automatic unless the merchant picks one.
 * Automatic is almost always right (it is chosen by contrast, per mode), so
 * the choice is a quiet line under the fill rather than a row of its own.
 */
function TextOnRow({
  role,
  fill,
  value,
  defaultValue,
  resolved,
  dark,
  onChange,
  tSafe,
}: {
  role: ColorRole;
  fill: ColorRole;
  value: string;
  defaultValue: string;
  resolved: Record<ColorRole, string>;
  dark: boolean;
  onChange: (role: ColorRole, value: string) => void;
  tSafe: TSafe;
}) {
  const auto = value === defaultValue;
  const color = resolved[role];
  // Sale text sits on the PAGE, every other text role on its fill.
  const ground = role === "saleText" ? resolved.surface : resolved[fill];
  const ratio = contrastRatio(color, ground);
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate">{roleLabel(role, tSafe)}</span>
      <ColorSwatchPicker
        ariaLabel={roleLabel(role, tSafe)}
        value={normalizeColorToHex(color) ?? "#000000"}
        onChange={(hex) => onChange(role, normalizeColorToHex(hex) ?? hex)}
        alpha={false}
        align="end"
      >
        <button
          type="button"
          aria-label={roleLabel(role, tSafe)}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted/60"
        >
          <Swatch color={color} className="h-3.5 w-3.5 rounded-[4px]" />
          <span>
            {auto
              ? tSafe("admin.themeEditor.sourceAuto", "Auto")
              : color.toUpperCase()}
            {" · "}
            {ratio.toFixed(1)}:1
          </span>
        </button>
      </ColorSwatchPicker>
      {!auto ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 text-muted-foreground"
          aria-label={dark
            ? tSafe("admin.themeEditor.backToAuto", "Back to auto")
            : tSafe("admin.themeEditor.textAuto", "Automatic text color")}
          title={tSafe("admin.themeEditor.textAuto", "Automatic text color")}
          onClick={() => onChange(role, defaultValue)}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}
