"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InventorySelect,
  type Action,
  type Label as Translate,
  type Money,
  type Position,
  type Preview,
} from "./shared";

export type InventoryActionForm = {
  quantity: string;
  price: string;
  mode: string;
  field: string;
  payment: string;
  paidFrom: string;
  paymentDate: string;
  reason: string;
  disposition: string;
  note: string;
  expenseId: string;
};
export type ExpenseOption = {
  _id: string;
  description: string;
  amount: number;
  currency: string;
  revision: number;
  debitAccount?: string;
};

export function InventoryActionDialog({
  target,
  action,
  form,
  onChange,
  onClose,
  onSubmit,
  expenses,
  expensesLoading,
  preview,
  saving,
  error,
  label,
  money,
}: {
  target: Position | null;
  action: Action;
  form: InventoryActionForm;
  onChange: (field: keyof InventoryActionForm, value: string) => void;
  onClose: () => void;
  onSubmit: (commit: boolean) => void;
  expenses: ExpenseOption[];
  expensesLoading: boolean;
  preview: Preview | null;
  saving: boolean;
  error: string;
  label: Translate;
  money: Money;
}) {
  const title =
    action === "receipts"
      ? label("receive", "Add stock")
      : action === "adjustments"
        ? label("adjust", "Adjust inventory")
        : label("revalue", "Change fixed cost");
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview)
      previewRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
  }, [preview]);
  const select = (
    field: keyof InventoryActionForm,
    title: string,
    options: Array<[string, string]>,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`inventory-${field}`}>{title}</Label>
      <InventorySelect
        id={`inventory-${field}`}
        value={form[field]}
        onChange={(value) => onChange(field, value)}
        disabled={saving}
        options={options.map(([value, label]) => ({ value, label }))}
      />
    </div>
  );
  const quantityMin =
    action === "receipts" ? 1 : form.mode === "set" ? 0 : undefined;
  const valid =
    form.note.trim().length > 0 &&
    (action === "valuation-changes" ||
      (form.quantity.trim() !== "" &&
        Number.isSafeInteger(Number(form.quantity)) &&
        (quantityMin === undefined || Number(form.quantity) >= quantityMin))) &&
    (action === "adjustments" ||
      (form.price.trim() !== "" &&
        Number.isFinite(Number(form.price)) &&
        Number(form.price) >= 0)) &&
    (action !== "receipts" ||
      form.payment !== "already_recorded" ||
      expenses.some((expense) => expense._id === form.expenseId));

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target?.productName} ·{" "}
            {target?.sku || target?.variantName || label("mainSku", "Main SKU")}{" "}
            ·{" "}
            {target?.locationName ?? label("unassigned", "Unassigned location")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {preview ? <Check className="size-3" /> : "1"}
          </span>
          <span>{label("enterDetails", "Enter details")}</span>
          <ChevronRight className="size-3 text-muted-foreground" />
          <span
            className={`flex size-5 items-center justify-center rounded-full ${preview ? "bg-primary text-primary-foreground" : "border text-muted-foreground"}`}
          >
            2
          </span>
          <span>{label("reviewAndSave", "Review and save")}</span>
        </div>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onSubmit(Boolean(preview));
          }}
        >
          <fieldset disabled={saving} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {action !== "valuation-changes" && (
                <div className="space-y-1.5">
                  <Label htmlFor="inventory-quantity">
                    {form.mode === "adjust" && action === "adjustments"
                      ? label("quantityDelta", "Units to add or remove")
                      : label("quantity", "Quantity")}
                  </Label>
                  <Input
                    id="inventory-quantity"
                    type="number"
                    step="1"
                    min={quantityMin}
                    required
                    value={form.quantity}
                    onChange={(event) =>
                      onChange("quantity", event.target.value)
                    }
                  />
                  {action === "adjustments" && form.mode === "adjust" && (
                    <p className="text-xs text-muted-foreground">
                      {label(
                        "signedQuantityHint",
                        "Use a negative number to remove units, or a positive number to add them.",
                      )}
                    </p>
                  )}
                </div>
              )}
              {action !== "adjustments" && (
                <div className="space-y-1.5">
                  <Label htmlFor="inventory-price">
                    {action === "receipts"
                      ? label("purchasePrice", "Actual unit purchase price")
                      : label("newFixedCost", "New fixed unit cost")}{" "}
                    ({target?.currency})
                  </Label>
                  <Input
                    id="inventory-price"
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={form.price}
                    onChange={(event) => onChange("price", event.target.value)}
                  />
                </div>
              )}
            </div>
            {action === "receipts" && (
              <>
                <div className="flex justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {label("fixedCost", "Fixed unit cost")}
                  </span>
                  <span className="font-medium tabular-nums">
                    {target?.unitCost == null
                      ? label("missingCost", "Cost missing")
                      : money(target.unitCost, target.currency)}
                  </span>
                </div>
                {select(
                  "payment",
                  label("payment", "How was this stock paid for?"),
                  [
                    ["unpaid", label("unpaid", "Unpaid bill")],
                    ["paid", label("paid", "Already paid")],
                    [
                      "already_recorded",
                      label("alreadyRecorded", "Expense already recorded"),
                    ],
                  ],
                )}
                {form.payment === "paid" && (
                  <>
                    {select(
                      "paidFrom",
                      label("paidFrom", "Recorded payment account"),
                      [
                        ["bank", label("bank", "Bank")],
                        ["cash", label("cash", "Cash")],
                        ["gateway", label("gateway", "Gateway")],
                      ],
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="inventory-payment-date">
                        {label("paymentDate", "Payment date")}
                      </Label>
                      {/* A day, not a timestamp: the books date a payment by
                          the day it was made. Left empty, it is today. */}
                      <DateField
                        id="inventory-payment-date"
                        value={form.paymentDate}
                        onChange={(value) => onChange("paymentDate", value)}
                        placeholder={label("today", "Today")}
                        disableAfter={new Date()}
                        disabled={saving}
                      />
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {label(
                        "recordOnly",
                        "This records a payment you made; it does not send money.",
                      )}
                    </p>
                  </>
                )}
                {form.payment === "already_recorded" && (
                  <div className="space-y-1.5">
                    {select(
                      "expenseId",
                      label("expense", "Existing stock purchase"),
                      [
                        [
                          "",
                          expensesLoading
                            ? label("loading", "Loading…")
                            : label("chooseExpense", "Choose an expense"),
                        ],
                        ...expenses.map((expense): [string, string] => [
                          expense._id,
                          `${expense.description} · ${money(expense.amount, expense.currency)}`,
                        ]),
                      ],
                    )}
                    {!expensesLoading && expenses.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {label(
                          "noExpenses",
                          "No matching stock purchase expenses in this currency. Record the purchase in Expenses first.",
                        )}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {action === "adjustments" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {select("mode", label("mode", "Adjustment mode"), [
                    ["adjust", label("adjustBy", "Adjust by")],
                    ["set", label("setTo", "Set to")],
                  ])}
                  {select("field", label("field", "Counted state"), [
                    ["available", label("available", "Available")],
                    ["on_hand", label("onHand", "On hand")],
                  ])}
                </div>
                {select(
                  "reason",
                  label("reason", "Reason"),
                  [
                    "count",
                    "correction",
                    "damaged",
                    "theft_loss",
                    "promotion_donation",
                  ].map((reason) => [
                    reason,
                    label(`reasonLabel.${reason}`, reason.replaceAll("_", " ")),
                  ]),
                )}
                {form.reason === "damaged" &&
                  select(
                    "disposition",
                    label("disposition", "Damage disposition"),
                    [
                      [
                        "write_off_held",
                        label("writeOffHeld", "Write off held stock"),
                      ],
                      ["write_off", label("writeOff", "Write off")],
                      ["hold", label("hold", "Hold / quarantine")],
                      [
                        "release_hold",
                        label("releaseHold", "Release held stock"),
                      ],
                    ],
                  )}
              </>
            )}
            {action === "valuation-changes" && (
              <p className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
                {target?.missingCostQuantity
                  ? label(
                      "openingCost",
                      "This establishes the missing cost of recorded opening stock against opening equity; it does not create current profit.",
                    )
                  : label(
                      "revalueHint",
                      "The new cost applies to currently owned stock. Original order costs stay unchanged.",
                    )}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="inventory-note">
                {label("note", "Note / explanation")}
              </Label>
              <Textarea
                id="inventory-note"
                required
                maxLength={500}
                rows={3}
                value={form.note}
                placeholder={label(
                  "noteHint",
                  "Describe why this change is needed",
                )}
                onChange={(event) => onChange("note", event.target.value)}
              />
            </div>
          </fieldset>
          {preview && (
            <div
              ref={previewRef}
              aria-live="polite"
              className="scroll-mb-32 space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:scroll-mb-20"
            >
              <p className="text-sm font-semibold">
                {label("previewSummary", "Changes to be recorded")}
              </p>
              {preview.positions ? (
                preview.positions.map((position, index) => (
                  <div
                    key={position.key}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {label("position", "Position")} {index + 1}
                    </span>
                    <span className="font-medium tabular-nums">
                      {money(position.oldValue, position.currency)} →{" "}
                      {money(position.newValue, position.currency)}
                    </span>
                  </div>
                ))
              ) : (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {label("quantityChange", "Quantity change")}
                    </span>
                    <span className="font-medium tabular-nums">
                      {preview.delta}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {label("valueChange", "Book value change")}
                    </span>
                    <span className="font-medium tabular-nums">
                      {money(
                        preview.valueDelta ?? 0,
                        preview.currency ?? target?.currency ?? "USD",
                      )}
                    </span>
                  </div>
                  {preview.purchaseAmount != null && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {label("purchaseAmount", "Recorded purchase amount")}
                        </span>
                        <span className="tabular-nums">
                          {money(
                            preview.purchaseAmount,
                            preview.currency ?? target?.currency ?? "USD",
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {label("variance", "Inventory adjustment")}
                        </span>
                        <span className="tabular-nums">
                          {money(
                            preview.variance ?? 0,
                            preview.currency ?? target?.currency ?? "USD",
                          )}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter className="sticky bottom-0 z-10 border-t bg-background py-4">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {label("cancel", "Cancel")}
            </Button>
            <Button type="submit" disabled={saving || !valid}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving
                ? label("saving", "Saving…")
                : preview
                  ? label("confirm", "Confirm and save")
                  : label("preview", "Preview changes")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
