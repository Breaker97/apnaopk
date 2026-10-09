import {
  formatAppliedDateRange,
  rangeLengthDays,
  type AppliedDateRange,
  type DateRangePreset,
} from "@/components/ui/date-range-picker";
import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_FALLBACK_LABELS,
  resolveNamedPeriod,
} from "@/lib/admin/dashboard-period";
import { toCalendarRange } from "@/lib/date-filter";

type Label = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

/**
 * The period picker the dashboard and the Orders date filter share: the same
 * named spans, copy and footer, so "last 7 days" is worded and drawn the same on
 * both. Where the choice goes — the URL's `period`/`from`/`to` or a filter's
 * `date` — is each caller's own.
 */
export function periodPickerConfig(label: Label, locale: string, now: Date) {
  const presets: DateRangePreset[] = DASHBOARD_PERIODS.map((key) => ({
    id: key,
    label: label(
      `admin.dashboardPage.period.${key}`,
      DASHBOARD_PERIOD_FALLBACK_LABELS[key],
    ),
    range: toCalendarRange(resolveNamedPeriod(key, now), now),
  }));

  return {
    presets,
    presetsTitle: label("admin.dashboardPage.period.title", "Period"),
    customLabel: label("admin.dashboardPage.period.custom", "Custom range"),
    cancelLabel: label("common.cancel", "Cancel"),
    applyLabel: label("common.apply", "Apply"),
    summary: (draft: AppliedDateRange | null) =>
      draft
        ? `${formatAppliedDateRange(draft, locale)} · ${label(
            "admin.dashboardPage.period.days",
            "{count} days",
            { count: rangeLengthDays(draft) },
          )}`
        : label("admin.dashboardPage.period.pickTwo", "Pick a start and an end"),
  };
}
