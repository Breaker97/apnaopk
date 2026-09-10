"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  DateRangePicker,
  formatAppliedDateRange,
  rangeLengthDays,
  startOfDay,
  type AppliedDateRange,
  type DateRangePreset,
} from "@/components/ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

const PERIODS = ["7d", "30d", "90d", "ytd", "all"] as const;

const FALLBACK: Record<(typeof PERIODS)[number], string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "This year",
  all: "All time",
};

/** "2026-08-27" in the viewer's own days, which is what they picked. */
function toParam(date: Date) {
  const local = startOfDay(date);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

/** The same named spans the server resolves, so the calendar can paint them. */
function presetRange(key: (typeof PERIODS)[number], now: Date): AppliedDateRange {
  const from = new Date(now);
  switch (key) {
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "90d":
      from.setDate(from.getDate() - 90);
      break;
    case "ytd":
      from.setMonth(0, 1);
      break;
    case "all":
      from.setTime(0);
      break;
    default:
      from.setDate(from.getDate() - 30);
  }
  return { from: startOfDay(from), to: startOfDay(now) };
}

/**
 * Period and book selection, held in the URL.
 *
 * The URL rather than component state so a finance figure can be linked to and
 * comes back the same — someone sending "our September numbers" to an
 * accountant is the normal case, and a screen whose state lives in memory
 * cannot do it. It also keeps the page a server component: changing the period
 * is a navigation, and the aggregation re-runs where the data is.
 *
 * A named period is stored as its key and a picked one as two dates, which is
 * the difference between a link that means "last 30 days" tomorrow as well and
 * one that means the same thirty days forever. Both are wanted; a single
 * representation cannot be both.
 */
export function FinancePeriodPicker({
  period,
  from,
  to,
  book,
  showBookFilter,
}: {
  /** The resolved key: one of PERIODS, or "custom" when dates were picked. */
  period: string;
  /** The resolved bounds, so the picker never repeats the server's arithmetic. */
  from: string;
  to: string;
  book: string;
  showBookFilter: boolean;
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
  const applied: AppliedDateRange = {
    from: startOfDay(new Date(from)),
    to: startOfDay(new Date(to)),
  };
  const presets: DateRangePreset[] = PERIODS.map((key) => ({
    id: key,
    label: label(`finance.period.${key}`, FALLBACK[key]),
    range: presetRange(key, now),
  }));
  const activePreset = presets.find((preset) => preset.id === period);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showBookFilter ? (
        <Select
          // Normalized, not passed straight through: callers say "all" or
          // nothing at all for the unfiltered case, and a value matching no
          // item renders the trigger EMPTY rather than falling back — which is
          // what it did until someone looked at the screen.
          value={book === "own" || book === "marketplace" ? book : "all-books"}
          onValueChange={(value) =>
            setParams({ book: value === "all-books" ? null : value })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-books">
              {label("finance.book.all", "Both books")}
            </SelectItem>
            <SelectItem value="own">
              {label("finance.book.own", "Own store")}
            </SelectItem>
            <SelectItem value="marketplace">
              {label("finance.book.marketplace", "Marketplace")}
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      <DateRangePicker
        value={applied}
        locale={locale}
        // A named period says its name; only a picked one has to spell out its
        // dates. "All time" as a date range would be a sentence beginning in
        // 1970.
        triggerLabel={activePreset?.label}
        presets={presets}
        presetsTitle={label("finance.period.title", "Period")}
        activePresetId={activePreset?.id}
        customLabel={label("finance.period.custom", "Custom range")}
        onSelectPreset={(preset) =>
          setParams({ period: preset.id, from: null, to: null })
        }
        onApply={(range) =>
          setParams({
            period: null,
            from: toParam(range.from),
            to: toParam(range.to),
          })
        }
        summary={(draft) =>
          draft
            ? `${formatAppliedDateRange(draft, locale)} · ${label(
                "finance.period.days",
                "{count} days",
              ).replace("{count}", String(rangeLengthDays(draft)))}`
            : label("finance.period.pickTwo", "Pick a start and an end")
        }
        cancelLabel={label("common.cancel", "Cancel")}
        applyLabel={label("common.apply", "Apply")}
        triggerClassName="h-9 rounded-md border-input bg-background px-3 text-sm shadow-xs hover:bg-accent"
        iconClassName="size-4"
        calendarProps={{ disabled: { after: now } }}
      />
    </div>
  );
}
