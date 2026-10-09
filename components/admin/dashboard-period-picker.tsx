"use client";

import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/hooks/use-locale-navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  DateRangePicker,
  type AppliedDateRange,
} from "@/components/ui/date-range-picker";
import { periodPickerConfig } from "@/components/admin/period-picker-config";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  DEFAULT_DASHBOARD_PERIOD,
  type DashboardPeriodKey,
} from "@/lib/admin/dashboard-period";
import {
  dayToLocalDate,
  localDateToDay,
  toCalendarRange,
} from "@/lib/date-filter";

/**
 * Period selector for the dashboard's stat cards, held in the URL.
 *
 * Same contract as the Finance picker: a named period is stored as its key so a
 * link keeps meaning "the last 7 days", picked dates as `from`/`to`. Changing it is a
 * navigation, so the page stays a server component and the aggregation re-runs
 * where the data is — no client-side fetch, and no re-aggregation of anything
 * that did not change.
 */
export function DashboardPeriodPicker({
  period,
  from,
  to,
  defaultPeriod = DEFAULT_DASHBOARD_PERIOD,
}: {
  /** The resolved key: one of DASHBOARD_PERIODS, or "custom" when dates were picked. */
  period: string;
  /** The resolved bounds as "YYYY-MM-DD", empty for the unfiltered view. */
  from: string;
  to: string;
  /** What the page opens on with no `period`, so choosing it needs no parameter. */
  defaultPeriod?: DashboardPeriodKey;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  const setParams = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const now = new Date();
  const applied: AppliedDateRange =
    from && to
      ? { from: dayToLocalDate(from), to: dayToLocalDate(to) }
      : toCalendarRange(null, now);
  const picker = periodPickerConfig(label, locale, now);
  const activePreset = picker.presets.find((preset) => preset.id === period);

  return (
    <DateRangePicker
      value={applied}
      locale={locale}
      // A named period says its name; only a picked one spells out its dates.
      triggerLabel={activePreset?.label}
      collapseCalendar
      {...picker}
      activePresetId={activePreset?.id}
      onSelectPreset={(preset) =>
        setParams({
          // The default needs no parameter; every other choice, "all"
          // included, has to be spelled out or it would read as the default.
          period: preset.id === defaultPeriod ? null : preset.id,
          from: null,
          to: null,
        })
      }
      onApply={(range) =>
        setParams({
          period: null,
          from: localDateToDay(range.from),
          to: localDateToDay(range.to),
        })
      }
      triggerClassName="h-9 rounded-[10px] bg-card px-3.5 text-sm font-semibold shadow-xs"
      iconClassName="size-4"
      calendarProps={{ disabled: { after: now } }}
    />
  );
}
