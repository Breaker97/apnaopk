"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { ArrowUpRight, Plus, Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { WarningBanner } from "@/components/ui/warning-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { BOOST_MAX_POSITIONS } from "@/config/app.config";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useCurrency } from "@/providers/currency-provider";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  LADDER_SURFACES,
  LadderAxisHeader,
  LadderGapCard,
  LadderRungCard,
  isSurfaceOff,
  type BoostPositionRow,
} from "@/components/admin/boost-ladder-rung";
import { summarizeLadderWindow } from "@/lib/boosts/boost-ladder-track";
import type {
  SponsoredPlacementDepths,
  SponsoredPlacementsEnabled,
} from "@/lib/boosts/boost-placement-depths";
import { cn } from "@/lib/utils";

export type { BoostPositionRow } from "@/components/admin/boost-ladder-rung";

interface FormState {
  position: string;
  label: string;
  description: string;
  pricePerDay: string;
  status: "active" | "archived";
}

const EMPTY_FORM: FormState = {
  position: "1",
  label: "",
  description: "",
  pricePerDay: "",
  status: "active",
};

const API_BASE = "/api/admin/boosts/positions";
/**
 * Occupancy windows offered, before the store's horizon trims them. A store
 * that only opens 14 days of calendar was previously shown 30/60/90 with all
 * three disabled and "30" still painted as the selection.
 */
const WINDOW_CHOICES = [7, 14, 30, 60, 90] as const;

type LadderEntry =
  | { kind: "rung"; row: BoostPositionRow }
  | { kind: "gap"; from: number; to: number };

export function BoostPositionsLadder({
  locale,
  positions,
  today,
  depths,
  placementsEnabled,
  storeCurrency,
  horizonDays,
}: {
  locale: string;
  positions: BoostPositionRow[];
  today: string;
  depths: SponsoredPlacementDepths;
  placementsEnabled: SponsoredPlacementsEnabled;
  storeCurrency: string;
  horizonDays: number;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { currency, formatPrice } = useCurrency();
  // `t()` runs the ICU formatter, which throws when a placeholder in the
  // message has no value — so interpolation values are handed to `t()` itself,
  // and the fallback string gets the same substitution by hand.
  const label = useFallbackTranslator(t);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BoostPositionRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Every choice that fits inside the booking horizon, so there is always at
  // least one live button and the one that is selected is one you can pick.
  const windows = useMemo(() => {
    const fits = WINDOW_CHOICES.filter((days) => days <= horizonDays);
    return fits.length > 0 ? fits : [horizonDays];
  }, [horizonDays]);
  const [window, setWindow] = useState<number | null>(null);
  const activeWindow =
    window ?? (windows.includes(30) ? 30 : windows[windows.length - 1]);
  const windowDays = Math.min(activeWindow, horizonDays);

  const formatDay = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return (day: string) => format.format(new Date(`${day}T00:00:00.000Z`));
  }, [locale]);

  /**
   * The ladder as drawn: every defined rung, with each run of undefined rungs
   * between them as one gap entry — visual slots that always show a regular
   * product, because nothing below moves up.
   */
  const entries = useMemo<LadderEntry[]>(() => {
    const out: LadderEntry[] = [];
    let expected = 1;
    for (const row of positions) {
      if (row.position > expected) {
        out.push({ kind: "gap", from: expected, to: row.position - 1 });
      }
      out.push({ kind: "rung", row });
      expected = row.position + 1;
    }
    return out;
  }, [positions]);

  const gaps = useMemo(
    () =>
      entries.filter(
        (entry): entry is Extract<LadderEntry, { kind: "gap" }> =>
          entry.kind === "gap",
      ),
    [entries],
  );
  const gapCount = gaps.reduce((sum, gap) => sum + gap.to - gap.from + 1, 0);

  /** Rungs priced in a currency the store no longer uses — checkout refuses these. */
  const mispriced = useMemo(
    () =>
      positions.filter(
        (p) => p.currency && p.currency.toUpperCase() !== storeCurrency.toUpperCase(),
      ),
    [positions, storeCurrency],
  );

  const summaries = useMemo(
    () =>
      new Map(
        positions.map((row) => [
          row._id,
          summarizeLadderWindow(row.bookedDays, today, windowDays, horizonDays),
        ]),
      ),
    [positions, today, windowDays, horizonDays],
  );

  // How full the part of the ladder that is on sale is. Archived rungs are
  // left out: their free days are not inventory anyone can buy.
  const onSale = positions.filter((row) => row.status === "active");
  const ladderBooked = onSale.reduce(
    (sum, row) => sum + (summaries.get(row._id)?.booked ?? 0),
    0,
  );
  const ladderTotal = onSale.length * windowDays;

  const nextFreePosition = useMemo(() => {
    const taken = new Set(positions.map((p) => p.position));
    let n = 1;
    while (taken.has(n)) n += 1;
    return n;
  }, [positions]);

  const openCreate = (position = nextFreePosition) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, position: String(position) });
    setDialogOpen(true);
  };

  const openEdit = (row: BoostPositionRow) => {
    setEditing(row);
    setForm({
      position: String(row.position),
      label: row.label,
      description: row.description ?? "",
      pricePerDay: String(row.pricePerDay),
      status: row.status,
    });
    setDialogOpen(true);
  };

  const handleSave = useCallback(async () => {
    const position = Number(form.position);
    const pricePerDay = Number(form.pricePerDay);

    if (
      !editing &&
      (!Number.isInteger(position) ||
        position < 1 ||
        position > BOOST_MAX_POSITIONS)
    ) {
      toast.error(
        label(
          "boosts.positions.positionRequired",
          `Position must be 1–${BOOST_MAX_POSITIONS}`,
        ),
      );
      return;
    }
    if (!form.label.trim() || form.label.trim().length < 2) {
      toast.error(label("boosts.positions.labelRequired", "Enter a label"));
      return;
    }
    if (!Number.isFinite(pricePerDay) || pricePerDay <= 0) {
      toast.error(
        label(
          "boosts.positions.priceRequired",
          "Price per day must be greater than zero",
        ),
      );
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        label: form.label.trim(),
        description: form.description.trim(),
        pricePerDay,
        status: form.status,
      };
      if (editing) {
        await apiClient.put(`${API_BASE}/${editing._id}`, payload);
        toast.success(label("boosts.positions.updated", "Position updated"));
      } else {
        await apiClient.post(API_BASE, { ...payload, position });
        toast.success(label("boosts.positions.created", "Position created"));
      }
      setDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label("boosts.positions.saveFailed", "Could not save the position"),
      );
    } finally {
      setIsSaving(false);
    }
  }, [editing, form, label, router]);

  /**
   * Archive/unarchive applies. It used to open the edit dialog with the status
   * already flipped and wait for Save — so the button appeared to do nothing,
   * and a rung an admin believed they had taken off sale was still on sale.
   */
  const handleToggleArchive = useCallback(
    async (row: BoostPositionRow) => {
      const nextStatus = row.status === "active" ? "archived" : "active";
      if (nextStatus === "archived") {
        const ok = await confirm({
          title: label("boosts.positions.archiveTitle", "Archive this position?"),
          description: label(
            "boosts.positions.archiveDescription",
            "New bookings can no longer be made on #{position}. Days already sold keep running at the price they were sold at, and the rung number stays reserved.",
            { position: row.position },
          ),
          confirmText: label("boosts.positions.archive", "Archive"),
          cancelText: label("common.cancel", "Cancel"),
        });
        if (!ok) return;
      }

      setBusyId(row._id);
      try {
        await apiClient.put(`${API_BASE}/${row._id}`, { status: nextStatus });
        // The status words the badges already use, so the toast reads in the
        // admin's own language rather than in English.
        toast.success(
          nextStatus === "archived"
            ? label("boosts.positions.archived", "Archived")
            : label("boosts.positions.active", "Active"),
        );
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : label("boosts.positions.saveFailed", "Could not save the position"),
        );
      } finally {
        setBusyId(null);
      }
    },
    [confirm, label, router],
  );

  const handleDelete = useCallback(
    async (row: BoostPositionRow) => {
      const ok = await confirm({
        title: label("boosts.positions.deleteTitle", "Delete this position?"),
        description: label(
          "boosts.positions.deleteDescription",
          "Position numbers are reserved even while archived, so deleting is the only way to free #{position} for a new rung. Bookings from today onward block deletion.",
          { position: row.position },
        ),
        variant: "destructive",
      });
      if (!ok) return;

      setBusyId(row._id);
      try {
        await apiClient.delete(`${API_BASE}/${row._id}`);
        toast.success(label("boosts.positions.deleted", "Position deleted"));
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : label("boosts.positions.deleteFailed", "Could not delete"),
        );
      } finally {
        setBusyId(null);
      }
    },
    [confirm, label, router],
  );

  const gapList = gaps
    .map((gap) => (gap.from === gap.to ? `#${gap.from}` : `#${gap.from}–#${gap.to}`))
    .join(", ");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-bold">
            {label("boosts.positions.title", "Position ladder")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "boosts.positions.subtitle",
              "Vendors book a numbered slot for a range of days. An unsold slot shows a regular product — the slots below it never move up.",
            )}
          </p>
        </div>
        <Button onClick={() => openCreate()} className="shrink-0 gap-2">
          <Plus className="size-4" />
          {label("boosts.positions.add", "Add position")}
        </Button>
      </div>

      {mispriced.length > 0 && (
        <WarningBanner tone="danger">
          {label(
            "boosts.positions.currencyMismatch",
            "Positions {positions} were priced in a different currency to the store's {currency}. Re-price them — vendors cannot check out until you do.",
            {
              positions: mispriced.map((p) => `#${p.position}`).join(", "),
              currency: storeCurrency,
            },
          )}
        </WarningBanner>
      )}

      {gaps.length > 0 && (
        <WarningBanner
          action={
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => openCreate(gaps[0].from)}
            >
              {label("boosts.positions.defineGap", "Define #{position}", {
                position: gaps[0].from,
              })}
            </Button>
          }
        >
          {gapCount === 1
            ? label(
                "boosts.positions.ladderGapOne",
                "Position {positions} isn't defined — that slot always shows a regular product.",
                { positions: gapList },
              )
            : label(
                "boosts.positions.ladderGap",
                "Positions {positions} are undefined — those visual slots always show a regular product.",
                { positions: gapList },
              )}
        </WarningBanner>
      )}

      {positions.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-12 text-center">
            <Rocket className="mx-auto size-8 text-muted-foreground" />
            <p className="font-medium">
              {label("boosts.positions.empty", "No positions yet")}
            </p>
            <p className="text-sm text-muted-foreground">
              {label(
                "boosts.positions.emptyHint",
                "Create Position 1 to open the top sponsored slot for sale.",
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-xs text-muted-foreground">
                {label("boosts.positions.windowLabel", "Days ahead")}
              </span>
              <div
                role="group"
                aria-label={label("boosts.positions.windowLabel", "Days ahead")}
                className="inline-flex gap-0.5 rounded-lg border bg-card p-0.5"
              >
                {windows.map((days) => {
                  const active = activeWindow === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setWindow(days)}
                      className={cn(
                        "h-7 min-w-9 rounded-md px-2.5 text-xs tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-primary/10 font-semibold text-primary"
                          : "font-medium text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {days}
                    </button>
                  );
                })}
              </div>
              {ladderTotal > 0 ? (
                <span className="text-xs text-foreground">
                  {label(
                    "boosts.positions.ladderSummary",
                    "{percent}% of the ladder booked · {booked} of {total} days",
                    {
                      percent: Math.round((ladderBooked / ladderTotal) * 100),
                      booked: ladderBooked,
                      total: ladderTotal,
                    },
                  )}
                </span>
              ) : null}
            </div>
            {/* The depths are global — the same for every rung — so they are
                stated once here, and a card only says whether it is in. */}
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>
                {label("boosts.positions.slotsPerSurface", "Sponsored slots per surface:")}
              </span>
              <span className="font-medium text-foreground">
                {LADDER_SURFACES.map((surface) => {
                  const name = label(surface.nameKey, surface.fallback);
                  return isSurfaceOff(surface.key, depths, placementsEnabled)
                    ? `${name} ${label("boosts.positions.surfaceOff", "off")}`
                    : `${name} ${depths[surface.key]}`;
                }).join(" · ")}
              </span>
              <Link
                href={`/${locale}/admin/settings/boosting`}
                className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              >
                {label("boosts.positions.settingsLink", "Settings")}
                <ArrowUpRight className="size-3.5" />
              </Link>
            </p>
          </div>

          <div className="@container space-y-2">
            <LadderAxisHeader
              today={today}
              windowDays={windowDays}
              formatDay={formatDay}
              label={label}
            />
            {/* A vertical ordered list, not a grid: rung order is semantically
                vertical, and a multi-column grid reflows #4 above #3 on a
                narrow viewport — misdescribing the one thing this screen
                communicates. */}
            <ol className="space-y-2">
              {entries.map((entry) =>
                entry.kind === "gap" ? (
                  <li key={`gap-${entry.from}`}>
                    <LadderGapCard
                      from={entry.from}
                      to={entry.to}
                      label={label}
                      onDefine={() => openCreate(entry.from)}
                    />
                  </li>
                ) : (
                  <li key={entry.row._id}>
                    <LadderRungCard
                      row={entry.row}
                      locale={locale}
                      today={today}
                      windowDays={windowDays}
                      horizonDays={horizonDays}
                      summary={
                        summaries.get(entry.row._id) ??
                        summarizeLadderWindow([], today, windowDays, horizonDays)
                      }
                      depths={depths}
                      placementsEnabled={placementsEnabled}
                      storeCurrency={storeCurrency}
                      formatDay={formatDay}
                      label={label}
                      busy={busyId === entry.row._id}
                      onEdit={() => openEdit(entry.row)}
                      onToggleArchive={() => handleToggleArchive(entry.row)}
                      onDelete={() => handleDelete(entry.row)}
                    />
                  </li>
                ),
              )}
            </ol>
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? label("boosts.positions.editTitle", "Edit position")
                : label("boosts.positions.createTitle", "Add position")}
            </DialogTitle>
            <DialogDescription>
              {label(
                "boosts.positions.dialogDescription",
                "Vendors pay this price for every day they book at this position.",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="position">
                {label("boosts.positions.position", "Position")}
              </Label>
              <Input
                id="position"
                type="number"
                min={1}
                max={BOOST_MAX_POSITIONS}
                disabled={Boolean(editing)}
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
              {editing && (
                <p className="text-xs text-muted-foreground">
                  {label(
                    "boosts.positions.positionLocked",
                    "Position can't be changed after creation — archive this rung and create a new one.",
                  )}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="label">
                {label("boosts.positions.label", "Label")}
              </Label>
              <Input
                id="label"
                maxLength={80}
                placeholder={label(
                  "boosts.positions.labelPlaceholder",
                  "Top spot",
                )}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">
                {label("boosts.positions.description", "Description (optional)")}
              </Label>
              <Textarea
                id="description"
                rows={2}
                maxLength={500}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pricePerDay">
                {label("boosts.positions.pricePerDay", "Price per day")}
              </Label>
              <CurrencyInput
                id="pricePerDay"
                currencySymbol={currency.symbol || currency.code}
                min={0.01}
                step={0.01}
                value={form.pricePerDay}
                onChange={(e) =>
                  setForm({ ...form, pricePerDay: e.target.value })
                }
              />
              {Number(form.pricePerDay) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {label(
                    "boosts.positions.pricePerDayHint",
                    "7 days = {week} · 30 days = {month}",
                    {
                      week: formatPrice(Number(form.pricePerDay) * 7),
                      month: formatPrice(Number(form.pricePerDay) * 30),
                    },
                  )}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{label("boosts.positions.status", "Status")}</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm({ ...form, status: value as FormState["status"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    {label("boosts.positions.active", "Active")}
                  </SelectItem>
                  <SelectItem value="archived">
                    {label("boosts.positions.archived", "Archived")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isSaving}
            >
              {label("common.cancel", "Cancel")}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {label("common.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
