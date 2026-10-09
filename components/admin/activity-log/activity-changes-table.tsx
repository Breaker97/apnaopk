"use client";

import { useTranslations } from "next-intl";
import type { DiffRow, DiffValue } from "@/lib/activity-log/diff";
import { cn } from "@/lib/utils";

/**
 * The detail sheet's Changes table: one line per field that moved.
 *
 * Additions are green and removals red, and neither is left to colour: each value
 * carries a `+` or `−` and a screen-reader word. A masked value (`[REDACTED]`,
 * `••••1234`) is drawn as written but muted — the log never held the real one.
 */

const ADDED = "text-emerald-700 dark:text-emerald-400";
const REMOVED = "text-red-700 dark:text-red-400";

function ValueText({ value, emptyLabel }: { value: DiffValue; emptyLabel: string }) {
  if (value.empty) {
    return <span className="italic text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <span
      className={cn(
        "[overflow-wrap:anywhere]",
        value.masked && "font-mono text-muted-foreground",
      )}
    >
      {value.text}
    </span>
  );
}

function Signed({
  sign,
  label,
  className,
  children,
}: {
  sign: "+" | "−";
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("flex items-baseline gap-1.5", className)}>
      <span aria-hidden="true" className="shrink-0 font-semibold">
        {sign}
      </span>
      <span className="sr-only">{label}</span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export function ActivityChangesTable({ rows }: { rows: DiffRow[] }) {
  const t = useTranslations("admin.activityLogPage.sheet");
  const emptyLabel = t("empty");

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full table-fixed border-collapse text-xs">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            <th scope="col" className="w-[30%] px-3 py-2 font-medium">
              {t("field")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("before")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("after")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-b align-top last:border-0">
              <th
                scope="row"
                className="px-3 py-2 text-left font-mono font-normal [overflow-wrap:anywhere]"
              >
                {row.path}
              </th>
              {row.added || row.removed ? (
                <td colSpan={2} className="px-3 py-2">
                  <ul className="grid gap-1">
                    {row.removed?.map((value, index) => (
                      <li key={`removed-${index}`}>
                        <Signed sign="−" label={t("removed")} className={REMOVED}>
                          <ValueText value={value} emptyLabel={emptyLabel} />
                        </Signed>
                      </li>
                    ))}
                    {row.added?.map((value, index) => (
                      <li key={`added-${index}`}>
                        <Signed sign="+" label={t("added")} className={ADDED}>
                          <ValueText value={value} emptyLabel={emptyLabel} />
                        </Signed>
                      </li>
                    ))}
                    {row.reordered ? (
                      <li className="text-muted-foreground">{t("reordered")}</li>
                    ) : null}
                  </ul>
                </td>
              ) : (
                <>
                  <td className="px-3 py-2">
                    {row.before ? (
                      <Signed sign="−" label={t("removed")} className={REMOVED}>
                        <ValueText value={row.before} emptyLabel={emptyLabel} />
                      </Signed>
                    ) : (
                      <span aria-hidden="true" className="text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.after ? (
                      <Signed sign="+" label={t("added")} className={ADDED}>
                        <ValueText value={row.after} emptyLabel={emptyLabel} />
                      </Signed>
                    ) : (
                      <span aria-hidden="true" className="text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
