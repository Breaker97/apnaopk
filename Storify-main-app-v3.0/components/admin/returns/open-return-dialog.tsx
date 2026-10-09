"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { formatCurrency } from "@/lib/intl/money";
import {
  REFUND_DESTINATION_METHODS,
  getRefundDestinationLabel,
  getRefundDestinationRequiredFields,
} from "@/lib/returns/refund-settlement";
import { RETURN_REASONS } from "@/lib/returns/returns";
import type { ReturnMethod } from "@/lib/returns/return-shipping";

/** What `GET /api/<scope>/returns/new?orderId=` answers with. */
interface OpenReturnContext {
  problem: string | null;
  canOverride: boolean;
  settlesOutOfBand: boolean;
  currency: string;
  lines: Array<{
    orderItemIndex: number;
    name: string;
    ordered: number;
    returnable: number;
    blockedBy: "not_yours" | "digital" | "cancelled" | "not_delivered" | "unpaid" | null;
    windowClosed: boolean;
    finalSale: boolean;
  }>;
}

type OpenReturnDialogProps = {
  scope: "admin" | "vendor";
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: () => void;
};

const REASON_LABELS: Record<string, string> = {
  wrong_size_or_variant: "Wrong size or variant",
  damaged_or_defective: "Damaged or defective",
  not_as_described: "Not as described",
  wrong_item_received: "Wrong item received",
  arrived_late: "Arrived late",
  changed_mind: "Changed my mind",
  other: "Other",
};

const BLOCK_NOTES: Record<string, string> = {
  not_yours: "Another seller's item",
  digital: "Digital, cannot come back",
  cancelled: "Cancelled and refunded",
  not_delivered: "Not delivered yet",
  unpaid: "Not paid for yet",
};

function destinationPlaceholder(method: string, field: string): string {
  const mobile = method === "mobile_money";
  if (field === "provider") return mobile ? "Mobile money provider" : "Bank name";
  if (field === "accountNumber") return mobile ? "Mobile money number" : "Account number";
  if (field === "accountName") return "Account holder's name";
  return field;
}

/** A line only an override opens: past the return window, or final sale. */
function outsideRules(line: { windowClosed: boolean; finalSale: boolean }) {
  return line.windowClosed || line.finalSale;
}

const METHODS: Array<{ key: ReturnMethod; title: string; detail: string }> = [
  {
    key: "customer_ships",
    title: "The shopper sends it",
    detail: "They get the address and instructions, and add the tracking number.",
  },
  {
    key: "label",
    title: "We give a return label",
    detail: "Give its link now; a label file can be added to the return afterwards.",
  },
  {
    key: "no_shipping",
    title: "Nothing to send back",
    detail: "For a cheap or broken item. Refund it without waiting for a parcel.",
  },
];

/**
 * Opening a return for a shopper who asked by phone, email or chat. It is
 * approved as it opens, with how the parcel comes back, as Shopify's
 * merchant-created returns are. The same dialog for the store and for a
 * seller; a seller only sees their own lines as returnable.
 */
export function OpenReturnDialog(props: OpenReturnDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92dvh] grid-cols-1 overflow-y-auto sm:max-w-xl">
        {/* Mounted with the dialog, so every opening starts clean and loads
            what is returnable now — that moves with every refund and return
            on the order. */}
        <OpenReturnForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function OpenReturnForm({ scope, orderId, onOpenChange, onOpened }: OpenReturnDialogProps) {
  const [context, setContext] = useState<OpenReturnContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<ReturnMethod>("customer_ships");
  const [labelUrl, setLabelUrl] = useState("");
  const [override, setOverride] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");
  const [destination, setDestination] = useState({
    method: "",
    accountName: "",
    accountNumber: "",
    provider: "",
  });
  const [priced, setPriced] = useState<{
    key: string;
    total?: number;
    currency?: string;
    error?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/${scope}/returns/new?orderId=${encodeURIComponent(orderId)}`,
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.message || "");
        if (!cancelled) setContext(data.data as OpenReturnContext);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            (error instanceof Error && error.message) || "Could not load this order",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, orderId]);

  // Only the lines that can be chosen right now: unticking the override drops
  // the ones it had opened up.
  const selected = useMemo(
    () =>
      (context?.lines || [])
        .filter((line) => !line.blockedBy && (override || !outsideRules(line)))
        .map((line) => ({
          orderItemIndex: line.orderItemIndex,
          quantity: Math.min(
            line.returnable,
            Math.max(0, Math.floor(Number(quantities[line.orderItemIndex] || 0))),
          ),
          outsideRules: outsideRules(line),
        }))
        .filter((line) => line.quantity > 0),
    [context, quantities, override],
  );
  const needsOverride = selected.some((line) => line.outsideRules);
  // The lines only an override opens, and what keeps them shut.
  const heldLines = (context?.lines || []).filter(
    (line) => outsideRules(line) && !line.blockedBy && line.returnable > 0,
  );
  const anyPastWindow = heldLines.some((line) => line.windowClosed);
  const anyFinalSale = heldLines.some((line) => line.finalSale);
  // Every line already back, refunded, someone else's or out of reach: the
  // lines say why, and the rest of the form has nothing to act on.
  const nothingToOpen = !(context?.lines || []).some(
    (line) =>
      !line.blockedBy &&
      line.returnable > 0 &&
      (!outsideRules(line) || context?.canOverride),
  );
  const items = selected.map(({ orderItemIndex, quantity }) => ({
    orderItemIndex,
    quantity,
  }));
  const previewKey =
    context && !context.problem && items.length > 0 && reason
      ? JSON.stringify({ items, reason, override: needsOverride })
      : "";

  // The figure it would open at, priced by the same planner that opens it.
  useEffect(() => {
    if (!previewKey) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/${scope}/returns/new`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, ...JSON.parse(previewKey) }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setPriced(
          res.ok && data?.success
            ? { key: previewKey, total: data.data.total, currency: data.data.currency }
            : { key: previewKey, error: data?.message || "Could not price this selection" },
        );
      } catch {
        if (!cancelled) {
          setPriced({ key: previewKey, error: "Could not price this selection" });
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewKey, scope, orderId]);
  const preview = previewKey && priced?.key === previewKey ? priced : null;

  const submit = async () => {
    if (items.length === 0) {
      toast.error("Choose at least one item to take back");
      return;
    }
    if (!reason) {
      toast.error("Choose the reason the shopper gave");
      return;
    }
    if (reason === "other" && !note.trim()) {
      toast.error("Write down what went wrong");
      return;
    }
    if (needsOverride && overrideNote.trim().length < 3) {
      toast.error("Say why this return is opened outside the return rules");
      return;
    }
    if (method === "label" && !labelUrl.trim()) {
      toast.error("Give the label's link, or choose another way back");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/${scope}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          reason,
          customerNote: note.trim() || undefined,
          items,
          returnMethod: method,
          ...(method === "label" ? { labelUrl: labelUrl.trim() } : {}),
          ...(needsOverride ? { eligibilityOverride: { note: overrideNote.trim() } } : {}),
          ...(context?.settlesOutOfBand && destination.method
            ? {
                refundDestination: {
                  method: destination.method,
                  accountName: destination.accountName.trim() || undefined,
                  accountNumber: destination.accountNumber.trim() || undefined,
                  provider: destination.provider.trim() || undefined,
                },
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "");
      const opened = Array.isArray(data.data) ? data.data : [data.data];
      toast.success(
        `Opened ${opened.map((doc: { returnNumber?: string }) => doc.returnNumber).join(", ")}`,
      );
      onOpenChange(false);
      onOpened();
    } catch (error) {
      toast.error((error instanceof Error && error.message) || "Could not open the return");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Open a return</DialogTitle>
        <DialogDescription>
          For a shopper who asked by phone, email or chat. It opens approved,
          and the shopper is told how to send it back.
        </DialogDescription>
      </DialogHeader>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : !context ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : context.problem ? (
        <p className="text-sm text-muted-foreground">{context.problem}</p>
      ) : (
        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <span className="text-sm font-medium">What comes back</span>
            <div className="divide-y rounded-md border">
              {context.lines.map((line) => {
                const disabled =
                  Boolean(line.blockedBy) ||
                  line.returnable <= 0 ||
                  (outsideRules(line) && !override);
                const held = [
                  line.finalSale ? "final sale" : null,
                  line.windowClosed ? "past the return window" : null,
                ].filter(Boolean);
                const lineNote = line.blockedBy
                  ? BLOCK_NOTES[line.blockedBy]
                  : line.returnable <= 0
                    ? "Already returned or refunded"
                    : held.length > 0
                      ? `${line.returnable} of ${line.ordered} · ${held.join(", ")}`
                      : `${line.returnable} of ${line.ordered} can come back`;
                return (
                  <div
                    key={line.orderItemIndex}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-muted-foreground">{lineNote}</p>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={line.returnable}
                      step={1}
                      disabled={disabled}
                      aria-label={`Quantity of ${line.name}`}
                      className="w-20"
                      value={disabled ? "" : (quantities[line.orderItemIndex] ?? "")}
                      placeholder="0"
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [line.orderItemIndex]: event.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            {heldLines.length > 0 && !context.canOverride ? (
              <p className="text-xs text-muted-foreground">
                Only the store can open a return{" "}
                {anyPastWindow && anyFinalSale
                  ? "past the return window or on a final sale item"
                  : anyFinalSale
                    ? "on a final sale item"
                    : "past the return window"}
                .
              </p>
            ) : null}
          </div>

          {nothingToOpen ? (
            <p className="text-sm text-muted-foreground">
              Nothing on this order can come back now.
            </p>
          ) : (
            <>
              {context.canOverride && heldLines.length > 0 ? (
                <div className="grid gap-2">
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <Checkbox
                      checked={override}
                      onCheckedChange={(value) => setOverride(value === true)}
                      className="mt-0.5"
                    />
                    <span>
                      {anyPastWindow && anyFinalSale
                        ? "Open it outside the return rules"
                        : anyFinalSale
                          ? "Take back final sale items too"
                          : "Open it past the return window"}
                    </span>
                  </label>
                  {override ? (
                    <Textarea
                      value={overrideNote}
                      maxLength={500}
                      onChange={(event) => setOverrideNote(event.target.value)}
                      placeholder="Why — this is kept on the order's timeline"
                    />
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="open-return-reason">Reason the shopper gave</Label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger id="open-return-reason" className="w-full">
                      <SelectValue placeholder="Choose a reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {RETURN_REASONS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {REASON_LABELS[key] || key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="open-return-note">
                    Note{" "}
                    {reason === "other" ? null : (
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    )}
                  </Label>
                  <Input
                    id="open-return-note"
                    value={note}
                    maxLength={1000}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="What the shopper said"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <span className="text-sm font-medium">How it comes back</span>
                <div role="radiogroup" className="divide-y rounded-md border">
                  {METHODS.map((choice) => {
                    const active = method === choice.key;
                    return (
                      <button
                        key={choice.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setMethod(choice.key)}
                        className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                            active ? "border-primary" : "border-muted-foreground/40"
                          }`}
                        >
                          {active ? <span className="size-2 rounded-full bg-primary" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">{choice.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {choice.detail}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {method === "label" ? (
                  <Input
                    type="url"
                    placeholder="https:// link to the label"
                    value={labelUrl}
                    onChange={(event) => setLabelUrl(event.target.value)}
                  />
                ) : null}
                {method !== "no_shipping" ? (
                  <p className="text-xs text-muted-foreground">
                    It goes to the location that receives returns. Change it from the
                    Returns list if it should go elsewhere.
                  </p>
                ) : null}
              </div>

              {context.settlesOutOfBand ? (
                <div className="grid gap-2">
                  <span className="text-sm font-medium">
                    Where the refund goes{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </span>
                  <p className="text-xs text-muted-foreground">
                    This order was not paid online, so the refund is sent by hand.
                    Fill this in if the shopper gave their details.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={destination.method}
                      onValueChange={(value) =>
                        setDestination((current) => ({ ...current, method: value }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="How it is sent" />
                      </SelectTrigger>
                      <SelectContent>
                        {REFUND_DESTINATION_METHODS.map((key) => (
                          <SelectItem key={key} value={key}>
                            {getRefundDestinationLabel(key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {getRefundDestinationRequiredFields(destination.method).map((field) => (
                      <Input
                        key={field}
                        placeholder={destinationPlaceholder(destination.method, field)}
                        value={String(destination[field as keyof typeof destination] || "")}
                        onChange={(event) =>
                          setDestination((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {preview?.error ? (
                <p className="text-sm text-destructive">{preview.error}</p>
              ) : preview ? (
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Estimated refund</span>
                  <span className="font-medium">
                    {formatCurrency(Number(preview.total || 0), preview.currency || context.currency)}
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          disabled={submitting || !context || Boolean(context.problem) || nothingToOpen}
          onClick={() => void submit()}
        >
          {submitting ? "Opening…" : "Open return"}
        </Button>
      </DialogFooter>
    </>
  );
}
