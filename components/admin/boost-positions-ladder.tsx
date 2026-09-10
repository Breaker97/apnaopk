"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Rocket, Archive, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  BoostOccupancyStrip,
  type OccupancyDay,
} from "@/components/admin/boost-occupancy-strip";
import {
  getPositionVisibility,
  isPositionUnreachable,
  type SponsoredPlacementDepths,
} from "@/lib/boosts/boost-placement-depths";
import { cn } from "@/lib/utils";

export interface BoostPositionRow {
  _id: string;
  position: number;
  label: string;
  description: string;
  pricePerDay: number;
  currency: string;
  status: "active" | "archived";
  bookedDays: OccupancyDay[];
  /** Observed impressions/day for this rung over the last 30 days. */
  avgImpressionsPerDay: number | null;
}

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
const WINDOWS = [30, 60, 90] as const;

export function BoostPositionsLadder({
  positions,
  today,
  depths,
  storeCurrency,
  horizonDays,
}: {
  positions: BoostPositionRow[];
  today: string;
  depths: SponsoredPlacementDepths;
  storeCurrency: string;
  horizonDays: number;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { currency, formatPrice } = useCurrency();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BoostPositionRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(30);

  // `t()` runs the ICU formatter, which throws when a placeholder in the
  // message has no value — so interpolation values must be handed to `t()`
  // itself. The fallback string never reaches the formatter, so it gets the
  // same substitution by hand.
  const label = useCallback(
    (key: string, fallback: string, values?: Record<string, string | number>) => {
      if (t.has(key)) return t(key, values);
      if (!values) return fallback;
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        fallback,
      );
    },
    [t],
  );

  /** Undefined rungs between the defined ones — visual slots that always show organic. */
  const gaps = useMemo(() => {
    if (positions.length === 0) return [];
    const defined = new Set(positions.map((p) => p.position));
    const highest = Math.max(...defined);
    const missing: number[] = [];
    for (let n = 1; n < highest; n += 1) if (!defined.has(n)) missing.push(n);
    return missing;
  }, [positions]);

  /** Rungs priced in a currency the store no longer uses — checkout refuses these. */
  const mispriced = useMemo(
    () =>
      positions.filter(
        (p) => p.currency && p.currency.toUpperCase() !== storeCurrency.toUpperCase(),
      ),
    [positions, storeCurrency],
  );

  const nextFreePosition = useMemo(() => {
    const taken = new Set(positions.map((p) => p.position));
    let n = 1;
    while (taken.has(n)) n += 1;
    return n;
  }, [positions]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, position: String(nextFreePosition) });
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

      setDeletingId(row._id);
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
        setDeletingId(null);
      }
    },
    [confirm, label, router],
  );

  const stripWindow = Math.min(window, horizonDays);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {label("boosts.positions.title", "Position ladder")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "boosts.positions.subtitle",
              "Vendors book one position for a range of days. Position N renders at visual slot N; an unsold position shows a regular product and the ones below it never move up.",
            )}
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="size-4" />
          {label("boosts.positions.add", "Add position")}
        </Button>
      </div>

      {mispriced.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm">
              {label(
                "boosts.positions.currencyMismatch",
                "Positions {positions} were priced in a different currency to the store's {currency}. Re-price them — vendors cannot check out until you do.",
                {
                  positions: mispriced.map((p) => `#${p.position}`).join(", "),
                  currency: storeCurrency,
                },
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {gaps.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p className="text-sm">
              {label(
                "boosts.positions.ladderGap",
                "Positions {positions} are undefined — those visual slots always show a regular product.",
                { positions: gaps.map((n) => `#${n}`).join(", ") },
              )}
            </p>
          </CardContent>
        </Card>
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {label("boosts.positions.occupancy", "Occupancy")}
            </span>
            {WINDOWS.map((w) => (
              <Button
                key={w}
                size="sm"
                variant={window === w ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setWindow(w)}
                disabled={w > horizonDays}
              >
                {label("boosts.positions.horizonDays", "{days}d", { days: w })}
              </Button>
            ))}
          </div>

          {/* A vertical ordered list, not a grid: rung order is semantically
              vertical, and a 3-column grid reflows #4 above #3 on a narrow
              viewport — misdescribing the one thing this screen communicates. */}
          <ol className="space-y-3">
            {positions.map((row) => {
              const reach = getPositionVisibility(row.position, depths);
              const unreachable = isPositionUnreachable(row.position, depths);
              return (
                <li key={row._id}>
                  <Card>
                    <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
                      <div className="flex w-14 shrink-0 items-start justify-center">
                        <span className="rounded-md bg-muted px-2 py-1 text-lg font-bold tabular-nums">
                          #{row.position}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold">{row.label}</p>
                              <Badge
                                variant={
                                  row.status === "active" ? "default" : "secondary"
                                }
                              >
                                {label(
                                  `boosts.positions.${row.status}`,
                                  row.status === "active" ? "Active" : "Archived",
                                )}
                              </Badge>
                            </div>
                            {row.description && (
                              <p className="text-sm text-muted-foreground">
                                {row.description}
                              </p>
                            )}
                          </div>

                          <div className="text-right">
                            <p className="text-2xl font-bold">
                              {formatPrice(row.pricePerDay)}
                              <span className="ml-1 text-sm font-normal text-muted-foreground">
                                {label("boosts.positions.perDay", "/ day")}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {label(
                                "boosts.positions.derivedPrices",
                                "7 days {week} · 30 days {month}",
                                {
                                  week: formatPrice(row.pricePerDay * 7),
                                  month: formatPrice(row.pricePerDay * 30),
                                },
                              )}
                            </p>
                          </div>
                        </div>

                        <BoostOccupancyStrip
                          today={today}
                          days={stripWindow}
                          bookedDays={row.bookedDays}
                          labels={{
                            summary: (booked, total) =>
                              label(
                                "boosts.positions.occupancyBooked",
                                "{booked} of {total} days booked",
                                { booked, total },
                              ),
                            nextFree: (day) =>
                              label(
                                "boosts.positions.occupancyNextFree",
                                "next free {day}",
                                { day },
                              ),
                            fullyBooked: label(
                              "boosts.positions.occupancyFull",
                              "fully booked",
                            ),
                          }}
                        />

                        <p className="text-xs text-muted-foreground">
                          {label("boosts.positions.reach", "Renders on")}{" "}
                          <span className={cn(!reach.home && "line-through opacity-60")}>
                            {label("boosts.positions.reachHome", "Home (top {n})", {
                              n: depths.home,
                            })}
                          </span>
                          {" · "}
                          <span
                            className={cn(!reach.listing && "line-through opacity-60")}
                          >
                            {label(
                              "boosts.positions.reachListing",
                              "Listings (top {n})",
                              { n: depths.listing },
                            )}
                          </span>
                          {" · "}
                          <span
                            className={cn(
                              !reach.productPage && "line-through opacity-60",
                            )}
                          >
                            {label(
                              "boosts.positions.reachProductPage",
                              "Product pages (top {n})",
                              { n: depths.productPage },
                            )}
                          </span>
                        </p>

                        {unreachable && (
                          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {label(
                              "boosts.positions.reachesNothing",
                              "Position {position} renders nowhere. Raise a placement's slot count or archive this rung.",
                              { position: row.position },
                            )}
                          </p>
                        )}

                        {/* Observed delivery. What the rung is WORTH, next to
                            what it costs — this is the only evidence the admin
                            has that Position 1 should be priced above
                            Position 3, and it is the number a vendor will quote
                            back when they ask. */}
                        <p className="text-xs text-muted-foreground">
                          {row.avgImpressionsPerDay === null
                            ? label(
                                "boosts.positions.deliveryNone",
                                "No delivery recorded yet",
                              )
                            : label(
                                "boosts.positions.delivery",
                                "Averaged {n} impressions/day over the last 30 days",
                                {
                                  n: row.avgImpressionsPerDay.toLocaleString(),
                                },
                              )}
                        </p>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="size-3.5" />
                            {label("common.edit", "Edit")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() =>
                              openEdit({
                                ...row,
                                status:
                                  row.status === "active" ? "archived" : "active",
                              })
                            }
                          >
                            <Archive className="size-3.5" />
                            {row.status === "active"
                              ? label("boosts.positions.archive", "Archive")
                              : label("boosts.positions.unarchive", "Unarchive")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            disabled={deletingId === row._id}
                            onClick={() => handleDelete(row)}
                          >
                            <Trash2 className="size-3.5" />
                            {label("common.delete", "Delete")}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ol>
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
                max={50}
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
