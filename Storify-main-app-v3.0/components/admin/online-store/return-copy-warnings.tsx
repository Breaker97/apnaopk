"use client";

import { AlertTriangle } from "lucide-react";
import type { ReturnPolicyCopyWarning } from "@/lib/site-config/return-policy-copy";

const FEATURE_WARNINGS: Record<string, string> = {
  photos: "It asks for photos, but the return form has no way to add one.",
};

function describe(warning: ReturnPolicyCopyWarning): string {
  if (warning.kind === "feature") return FEATURE_WARNINGS[warning.feature] ?? "";
  const said = warning.days.map((days) => `${days} days`).join(", ");
  return warning.windowDays === null
    ? `It says ${said}, but returns have no time limit (Settings → Orders).`
    : `It says ${said}, but returns close ${warning.windowDays} days after delivery (Settings → Orders).`;
}

/**
 * Where a page's return copy no longer matches the store — shared by the
 * Return Policy and FAQ editors. The merchant's words are never changed for
 * them; this says where they have gone stale, and how to keep the window in
 * step for good.
 */
export function ReturnCopyWarnings({
  warnings,
  windowDays,
}: {
  warnings: ReturnPolicyCopyWarning[];
  /** Null for no time limit. */
  windowDays: number | null;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Write <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{windowDays}"}</code>{" "}
        anywhere for the return window set in Settings → Orders (
        {windowDays === null ? "no time limit" : `${windowDays} days`} now), so the
        page always matches it, and{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{storeName}"}</code>{" "}
        for the store name.
      </p>
      {warnings.length > 0 ? (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            This page no longer matches how the store handles returns
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {warnings.map((warning) => (
              <li key={warning.kind === "days" ? "days" : warning.feature}>
                {describe(warning)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
