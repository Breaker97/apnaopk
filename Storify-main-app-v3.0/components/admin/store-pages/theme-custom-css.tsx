"use client";

import { useState } from "react";
import { Braces, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { CUSTOM_CSS_MAX_LENGTH } from "@/lib/storefront/themes/custom-css";

/**
 * The Themes page's Custom CSS tab: one sheet for the active theme, saved
 * through its own route. Plain textarea on purpose — the sheet is short
 * overrides on top of the token system, not a place to build a theme, and
 * a code editor would say otherwise.
 */
export function ThemeCustomCss({
  themeId,
  themeName,
  initialCss,
  tSafe,
}: {
  themeId: string;
  themeName: string;
  initialCss: string;
  tSafe: (key: string, fallback: string) => string;
}) {
  const [css, setCss] = useState(initialCss);
  const [saved, setSaved] = useState(initialCss);
  const [saving, setSaving] = useState(false);
  const dirty = css !== saved;

  const save = async () => {
    setSaving(true);
    try {
      const result = await apiClient.patch<{ theme: string; css: string }>(
        "/api/admin/theme-settings/custom-css",
        { css },
      );
      setCss(result.css);
      setSaved(result.css);
      toast.success(
        tSafe("admin.themeSettings.customCss.saved", "Custom CSS saved"),
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.themeSettings.saveFailed", "Saving failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Braces className="h-4 w-4 text-primary" />
          {tSafe("admin.themeSettings.customCss.title", "Custom CSS")}{" "}
          <span className="font-normal text-muted-foreground">
            · {themeName}
          </span>
        </CardTitle>
        <CardDescription>
          {tSafe(
            "admin.themeSettings.customCss.description",
            "Rules added after the theme's own styles, on every storefront page. Saved per theme — switching themes switches to that theme's own sheet. Prefer Theme settings for colors, type, and shapes; use this for the details they don't reach.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={css}
          onChange={(event) => setCss(event.target.value)}
          maxLength={CUSTOM_CSS_MAX_LENGTH}
          spellCheck={false}
          rows={18}
          placeholder={`.store-surface[data-store-theme="${themeId}"] .my-selector {\n  /* … */\n}`}
          className="min-h-[24rem] resize-y font-mono text-[13px] leading-relaxed"
          aria-label={tSafe("admin.themeSettings.customCss.title", "Custom CSS")}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {tSafe(
              "admin.themeSettings.customCss.hint",
              "Scope rules to `.store-surface` so they never reach the admin.",
            )}{" "}
            <span className="tabular-nums">
              {css.length.toLocaleString()} /{" "}
              {CUSTOM_CSS_MAX_LENGTH.toLocaleString()}
            </span>
          </p>
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {tSafe("admin.themeSettings.customCss.save", "Save CSS")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
