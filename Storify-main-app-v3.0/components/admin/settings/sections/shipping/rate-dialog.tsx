"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  EditDialogFooter,
  EditDialogHeader,
  FieldLine,
  Segmented,
  SwitchRow,
  Unit,
  useDraft,
} from "./dialog-fields";
import type { ShippingRate } from "./rate-summary";

type RateType = NonNullable<ShippingRate["type"]>;

const RATE_TYPES: readonly RateType[] = [
  "flat",
  "free_over",
  "subtotal_range",
  "weight_range",
];

/**
 * Add or edit one rate of a zone, or the fallback rate for addresses no zone
 * covers (`variant="fallback"`: a name, a price and a delivery window).
 *
 * It edits a copy: Done hands the copy back, Cancel drops it, so a rate half
 * filled in never reaches the page's unsaved changes. Mount it with a `key`
 * per rate so each opening starts from that rate.
 */
export function RateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: "rate" | "fallback";
  /** A rate being added: Done adds it even untouched. */
  isNew?: boolean;
  initial: ShippingRate;
  zoneName?: string;
  currency: string;
  weightUnit: string;
  /** The store's processing time in words ("1–2 days"), when it has one. */
  processingText?: string;
  onDone: (rate: ShippingRate) => void;
  /** Deletes the rate, or with `variant="fallback"` switches the fallback off. */
  onRemove?: () => void;
}) {
  const t = useTranslations("admin.settings.shipping");
  const { draft, set, changed } = useDraft<ShippingRate>(props.initial);
  const fallback = props.variant === "fallback";
  const type: RateType = fallback ? "flat" : (draft.type ?? "flat");

  const typeLabels: Record<RateType, string> = {
    flat: t("rate.type.flat"),
    free_over: t("rate.type.freeOver"),
    subtotal_range: t("rate.type.subtotalRange"),
    weight_range: t("rate.type.weightRange"),
  };
  const typeHints: Record<RateType, string> = {
    flat: t("rate.typeHint.flat"),
    free_over: t("rate.typeHint.freeOver"),
    subtotal_range: t("rate.typeHint.subtotalRange"),
    weight_range: t("rate.typeHint.weightRange"),
  };

  const title = fallback
    ? t("fallback.dialogTitle")
    : props.isNew
      ? t("rate.dialogTitleNew")
      : t("rate.dialogTitleEdit");
  const description = fallback ? t("fallback.dialogHint") : props.zoneName;

  const money = (
    id: string,
    value: number | undefined,
    onChange: (next: number | undefined) => void,
    options: { optional?: boolean; ariaLabel?: string } = {},
  ) => (
    <NumberInput
      id={id}
      aria-label={options.ariaLabel}
      // Room for the "No limit" placeholder at a phone's larger input text.
      className={options.optional ? "w-28" : "w-24"}
      min={0}
      step={0.01}
      value={value}
      placeholder={options.optional ? t("rate.noLimit") : undefined}
      whenEmpty={options.optional ? undefined : 0}
      onValueChange={onChange}
    />
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="grid-cols-1 gap-0 p-0 sm:max-w-xl">
        <EditDialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </EditDialogHeader>

        <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <label htmlFor="rate-name" className="text-sm font-medium">
              {t("rate.name")}
            </label>
            <Input
              id="rate-name"
              value={draft.name ?? ""}
              placeholder={t("rate.namePlaceholder")}
              onChange={(event) => set({ name: event.target.value })}
            />
            <p className="text-muted-foreground text-xs">{t("rate.nameHint")}</p>
          </div>

          {fallback ? null : (
            <div className="space-y-1.5">
              <p id="rate-type-label" className="text-sm font-medium">
                {t("rate.typeLabel")}
              </p>
              <Segmented
                labelledBy="rate-type-label"
                className="grid-cols-2 sm:grid-cols-4"
                value={type}
                options={RATE_TYPES.map((id) => ({ id, label: typeLabels[id] }))}
                onChange={(next) => set({ type: next })}
              />
              <p className="text-muted-foreground text-xs">{typeHints[type]}</p>
            </div>
          )}

          {type === "free_over" ? (
            <FieldLine label={t("rate.freeOver")} htmlFor="rate-free-over">
              {money("rate-free-over", draft.freeOver ?? 0, (next) =>
                set({ freeOver: next ?? 0 }),
              )}
              <Unit>{props.currency}</Unit>
            </FieldLine>
          ) : (
            <FieldLine label={t("rate.price")} htmlFor="rate-price">
              {money("rate-price", draft.price ?? 0, (next) =>
                set({ price: next ?? 0 }),
              )}
              <Unit>{props.currency}</Unit>
              {type === "weight_range" ? (
                <>
                  <Unit>+</Unit>
                  {money(
                    "rate-per-weight",
                    draft.pricePerWeightUnit ?? 0,
                    (next) => set({ pricePerWeightUnit: next ?? 0 }),
                    { ariaLabel: t("rate.pricePerWeightUnit", { unit: props.weightUnit }) },
                  )}
                  <Unit>{t("rate.perUnit", { unit: props.weightUnit })}</Unit>
                </>
              ) : null}
            </FieldLine>
          )}

          {type === "subtotal_range" ? (
            <FieldLine label={t("rate.orderValueRange")} htmlFor="rate-min-subtotal">
              {money("rate-min-subtotal", draft.minSubtotal, (next) =>
                set({ minSubtotal: next }),
              { optional: true })}
              <Unit>{t("units.to")}</Unit>
              {money(
                "rate-max-subtotal",
                draft.maxSubtotal,
                (next) => set({ maxSubtotal: next }),
                { optional: true, ariaLabel: t("rate.maxSubtotal") },
              )}
              <Unit>{props.currency}</Unit>
            </FieldLine>
          ) : null}

          {type === "weight_range" ? (
            <FieldLine label={t("rate.weightRangeLabel")} htmlFor="rate-min-weight">
              {money("rate-min-weight", draft.minWeight, (next) =>
                set({ minWeight: next }),
              { optional: true })}
              <Unit>{t("units.to")}</Unit>
              {money(
                "rate-max-weight",
                draft.maxWeight,
                (next) => set({ maxWeight: next }),
                { optional: true, ariaLabel: t("rate.maxWeight") },
              )}
              <Unit>{props.weightUnit}</Unit>
            </FieldLine>
          ) : null}

          <div className="space-y-1.5">
            <FieldLine label={t("rate.deliveryTime")} htmlFor="rate-min-days">
              <NumberInput
                id="rate-min-days"
                className="w-20"
                min={0}
                step={1}
                normalize={Math.trunc}
                value={draft.minDays ?? 0}
                whenEmpty={0}
                onValueChange={(next) => set({ minDays: next ?? 0 })}
              />
              <Unit>{t("units.to")}</Unit>
              <NumberInput
                className="w-20"
                aria-label={t("rate.maxDays")}
                min={0}
                step={1}
                normalize={Math.trunc}
                value={draft.maxDays ?? 0}
                whenEmpty={0}
                onValueChange={(next) => set({ maxDays: next ?? 0 })}
              />
              <Unit>{t("units.days")}</Unit>
            </FieldLine>
            {props.processingText ? (
              <p className="text-muted-foreground text-xs">
                {t("rate.processingAdded", { time: props.processingText })}
              </p>
            ) : null}
          </div>

          {fallback ? null : (
            <SwitchRow
              title={t("rate.offer")}
              hint={t("rate.offerHint")}
              checked={draft.active !== false}
              onCheckedChange={(checked) => set({ active: checked })}
            />
          )}
        </div>

        <EditDialogFooter
          removeLabel={fallback ? t("fallback.remove") : t("rate.delete")}
          onRemove={props.onRemove}
          onCancel={() => props.onOpenChange(false)}
          onDone={() =>
            changed || props.isNew
              ? props.onDone({ ...draft, type })
              : props.onOpenChange(false)
          }
        />
      </DialogContent>
    </Dialog>
  );
}
