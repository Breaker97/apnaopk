"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Read-only hint shown under a credential field when its value is supplied by
 * an environment variable (`.env`). The DB/Settings value still takes
 * precedence — this just explains why a provider works with empty-looking
 * fields. Render only when `show` is true.
 */
export function EnvSourceHint({ show }: { show?: boolean }) {
  const t = useTranslations("admin.settings.fields");
  if (!show) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="h-3 w-3" aria-hidden="true" />
      <span>{t("envSourceHint")}</span>
    </p>
  );
}
