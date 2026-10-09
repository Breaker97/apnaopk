"use client";

import { useEffect, useState } from "react";
import { Check, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";

/**
 * A vendor's offers on its abandoned checkouts: a discount sent by hand to the
 * shopper of one checkout, and a standing one the store's recovery email
 * carries. The store sends both; the vendor never learns who the shopper is,
 * and the discount comes off the vendor's own goods and payout. See
 * `lib/orders/abandoned-offers.ts`.
 *
 * Both dialogs are mounted fresh for each opening (the caller keys them).
 */

/** The store's limits on offers, as the vendor's page passes them in. */
export interface AbandonedOfferLimits {
  maxPercent: number;
  maxValidDays: number;
}

type OfferType = "percentage" | "fixed";

const VALIDITY_CHOICES = [1, 3, 7, 14] as const;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** The server's own sentence — a field's, when it named one. */
function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    const field = error.errors && Object.values(error.errors).flat()[0];
    return field || error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function TypeChoice({
  value,
  onChange,
}: {
  value: OfferType;
  onChange: (next: OfferType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Discount type">
      {(
        [
          ["percentage", "Percent off"],
          ["fixed", "Amount off"],
        ] as const
      ).map(([key, label]) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background hover:bg-muted",
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5" /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ValueInput({
  id,
  type,
  value,
  onChange,
  invalid,
}: {
  id: string;
  type: OfferType;
  value: number | null;
  onChange: (next: number | null) => void;
  invalid?: boolean;
}) {
  const { currency } = useCurrency();
  return (
    <div
      className={cn(
        "flex h-10 items-center rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        invalid && "border-destructive",
      )}
    >
      {type === "fixed" ? (
        <span className="ps-3 text-sm text-muted-foreground">{currency.symbol}</span>
      ) : null}
      <NumberInput
        id={id}
        value={value ?? undefined}
        onValueChange={(next) => onChange(next ?? null)}
        min={0}
        inputMode="decimal"
        placeholder={type === "fixed" ? "0.00" : "10"}
        className="h-full border-0 bg-transparent ps-1.5 shadow-none focus-visible:ring-0"
      />
      {type === "percentage" ? (
        <span className="pe-3 text-sm text-muted-foreground">%</span>
      ) : null}
    </div>
  );
}

function ValidityChoice({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (next: number) => void;
  max: number;
}) {
  const choices = VALIDITY_CHOICES.filter((days) => days <= max);
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">Valid for</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((days) => {
          const selected = value === days;
          return (
            <button
              key={days}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(days)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              {selected ? <Check className="h-3.5 w-3.5" /> : null}
              {days === 1 ? "1 day" : `${days} days`}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** What is wrong with the numbers as typed, by the store's limits; null when fine. */
function valueProblem(
  type: OfferType,
  value: number | null,
  limits: AbandonedOfferLimits,
  maxAmount: number | null,
  formatPrice: (amount: number) => string,
) {
  if (!(value && value > 0)) return "Enter a discount above zero.";
  if (type === "percentage" && value > limits.maxPercent) {
    return `The store allows at most ${limits.maxPercent}% off.`;
  }
  if (type === "fixed" && maxAmount !== null && value > maxAmount) {
    return `The store allows at most ${formatPrice(maxAmount)} off your items here.`;
  }
  return null;
}

/**
 * One checkout's offer, sent now. The preview shows what the vendor's own
 * items come to with it — the only part of the basket the vendor sees.
 */
export function SendOfferDialog({
  open,
  onOpenChange,
  checkoutId,
  productNames,
  subtotal,
  limits,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkoutId: string;
  productNames: string[];
  /** The vendor's own items in the checkout. */
  subtotal: number;
  limits: AbandonedOfferLimits;
  onSent?: () => void;
}) {
  const { formatPrice } = useCurrency();
  const [type, setType] = useState<OfferType>("percentage");
  const [value, setValue] = useState<number | null>(Math.min(10, limits.maxPercent));
  const [validDays, setValidDays] = useState(Math.min(3, limits.maxValidDays));
  const [saving, setSaving] = useState(false);
  // When the dialog opened: the preview's "valid until" counts from it, and a
  // render must not read the clock.
  const [openedAt] = useState(() => Date.now());

  const maxAmount = round2((subtotal * limits.maxPercent) / 100);
  const discount =
    type === "percentage"
      ? round2((subtotal * (value ?? 0)) / 100)
      : Math.min(value ?? 0, subtotal);
  const problem = valueProblem(type, value, limits, maxAmount, formatPrice);
  const until = new Date(openedAt + validDays * 24 * 60 * 60 * 1000).toLocaleDateString();

  const send = async () => {
    if (problem) return;
    setSaving(true);
    try {
      const result = await apiClient.post<{ outcome?: string }>(
        `/api/vendor/abandoned-checkouts/${checkoutId}/offer`,
        { type, value, validDays },
      );
      if (result?.outcome === "sent") toast.success("Offer sent to the shopper");
      else if (result?.outcome === "queued") {
        toast.info("Offer queued — delivery is being retried");
      } else toast.error("The offer could not be sent");
      onSent?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorText(error, "The offer could not be sent"));
    } finally {
      setSaving(false);
    }
  };

  const shown = productNames.slice(0, 3).join(", ");
  const more = productNames.length > 3 ? ` and ${productNames.length - 3} more` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send an offer</DialogTitle>
          <DialogDescription>
            The store emails the shopper a discount on your items in this
            checkout. You won&apos;t see who they are, and the discount comes off
            your earnings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {shown ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Your items: </span>
              {shown}
              {more}
            </p>
          ) : null}

          <TypeChoice
            value={type}
            onChange={(next) => {
              setType(next);
              setValue(next === "percentage" ? Math.min(10, limits.maxPercent) : null);
            }}
          />

          <div className="grid gap-1.5">
            <Label htmlFor="abandoned-offer-value">
              {type === "percentage" ? "Discount" : "Amount off"}
            </Label>
            <ValueInput
              id="abandoned-offer-value"
              type={type}
              value={value}
              onChange={setValue}
              invalid={Boolean(problem) && value !== null}
            />
            <p className={cn("text-xs", problem && value !== null ? "text-destructive" : "text-muted-foreground")}>
              {problem && value !== null
                ? problem
                : type === "percentage"
                  ? `Up to ${limits.maxPercent}%.`
                  : `Up to ${formatPrice(maxAmount)} on these items.`}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3">
            <div>
              <div className="text-xs text-muted-foreground">The shopper pays for your items</div>
              <div className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums">
                {formatPrice(Math.max(0, subtotal - discount))}
              </div>
            </div>
            <div className="text-end text-xs leading-relaxed text-muted-foreground">
              <div className="tabular-nums">Was {formatPrice(subtotal)}</div>
              <div className="tabular-nums">You give {formatPrice(discount)}</div>
            </div>
          </div>

          <ValidityChoice value={validDays} onChange={setValidDays} max={limits.maxValidDays} />

          <div className="flex items-start gap-2.5 rounded-lg bg-primary/10 px-3 py-2.5 text-xs leading-relaxed text-primary">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              One offer per checkout. The code works once, only for this
              shopper, until {until}.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void send()} disabled={saving || Boolean(problem)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RuleResponse {
  rule: { enabled: boolean; type: OfferType; value: number; validDays: number };
  policy: { enabled: boolean; automatic: boolean; maxPercent: number; maxValidDays: number };
  storeSendsRecoveryEmails: boolean;
}

/**
 * The vendor's standing offer: sent with the store's second recovery reminder
 * to every shopper who leaves the vendor's goods in a checkout.
 */
export function AutomaticOfferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { formatPrice } = useCurrency();
  const [loaded, setLoaded] = useState<RuleResponse | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [type, setType] = useState<OfferType>("percentage");
  const [value, setValue] = useState<number | null>(10);
  const [validDays, setValidDays] = useState(3);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    apiClient
      .get<RuleResponse>("/api/vendor/abandoned-checkouts/offer-rule")
      .then((data) => {
        if (!active || !data) return;
        setLoaded(data);
        setEnabled(Boolean(data.rule.enabled));
        setType(data.rule.type === "fixed" ? "fixed" : "percentage");
        setValue(Number(data.rule.value) || null);
        setValidDays(Math.min(Number(data.rule.validDays) || 3, data.policy.maxValidDays));
      })
      .catch((error) => {
        if (!active) return;
        toast.error(errorText(error, "Could not load your automatic offer"));
        onOpenChange(false);
      });
    return () => {
      active = false;
    };
  }, [onOpenChange, open]);

  const limits = loaded?.policy ?? { maxPercent: 30, maxValidDays: 14 };
  const problem = enabled
    ? valueProblem(type, value, limits, null, formatPrice)
    : null;

  const save = async () => {
    if (problem || !loaded) return;
    setSaving(true);
    try {
      await apiClient.put("/api/vendor/abandoned-checkouts/offer-rule", {
        enabled,
        type,
        value: value ?? (type === "percentage" ? 10 : 1),
        validDays,
      });
      toast.success(enabled ? "Automatic offer saved" : "Automatic offer turned off");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorText(error, "Could not save your automatic offer"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Automatic offer</DialogTitle>
          <DialogDescription>
            Sent with the store&apos;s second reminder to shoppers who leave your
            products in a checkout. Where a checkout holds several sellers&apos;
            goods, the seller with the most in it makes the offer.
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          <div className="grid gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="abandoned-offer-auto">Send an automatic offer</Label>
              <Switch
                id="abandoned-offer-auto"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className={cn("grid gap-4", !enabled && "pointer-events-none opacity-50")}>
              <TypeChoice
                value={type}
                onChange={(next) => {
                  setType(next);
                  setValue(next === "percentage" ? Math.min(10, limits.maxPercent) : null);
                }}
              />
              <div className="grid gap-1.5">
                <Label htmlFor="abandoned-offer-auto-value">
                  {type === "percentage" ? "Discount" : "Amount off"}
                </Label>
                <ValueInput
                  id="abandoned-offer-auto-value"
                  type={type}
                  value={value}
                  onChange={setValue}
                  invalid={Boolean(problem)}
                />
                <p className={cn("text-xs", problem ? "text-destructive" : "text-muted-foreground")}>
                  {problem ??
                    (type === "percentage"
                      ? `Up to ${limits.maxPercent}%.`
                      : `Never more than ${limits.maxPercent}% of your items in a checkout: a larger amount is lowered to fit.`)}
                </p>
              </div>
              <ValidityChoice value={validDays} onChange={setValidDays} max={limits.maxValidDays} />
            </div>

            {!loaded.storeSendsRecoveryEmails ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  The store&apos;s automatic recovery emails are off, so this offer
                  won&apos;t go out until the store turns them on. You can still
                  send offers by hand.
                </span>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || !loaded || Boolean(problem)}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
