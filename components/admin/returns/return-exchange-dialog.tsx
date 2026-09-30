"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
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
import { toast } from "@/components/ui/toast-notification";
import { formatCurrency, quantizeToCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";
import {
  exchangeItemsProblem,
  exchangeSplit,
  priceExchange,
} from "@/lib/returns/exchange";

/**
 * Exchanging a return (R7): choosing what goes out instead of the money, and
 * making the exchange order once the goods are back. The return's value pays
 * for that order first; the shopper is sent a pay link for anything short, and
 * whatever is over stays on the return to refund.
 */

type ExchangeLineState = {
  key: string;
  productId: string;
  variantId?: string;
  name: string;
  sku?: string;
  quantity: string;
  unitPrice: string;
  listPrice: number;
};

type ExchangeOption = {
  key: string;
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  available: number | null;
};

/** What `GET /api/admin/returns/[id]/exchange` answers with. */
type ExchangeState = {
  items: Array<{
    productId: string;
    variantId?: string;
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    listPrice: number;
  }>;
  delivery: number;
  editable: boolean;
  currency: string;
  price: { taxRate: number };
  returnLeft: number;
  blocker: string | null;
};

const lineKey = (productId: string, variantId?: string) => `${productId}:${variantId || ""}`;

function toLines(state: ExchangeState): ExchangeLineState[] {
  return state.items.map((item) => ({
    key: lineKey(String(item.productId), item.variantId ? String(item.variantId) : undefined),
    productId: String(item.productId),
    variantId: item.variantId ? String(item.variantId) : undefined,
    name: item.name,
    sku: item.sku,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    listPrice: Number(item.listPrice || 0),
  }));
}

/**
 * Mounted for one return at a time and only while open, so every opening
 * starts from the return as the server has it now.
 */
export function ReturnExchangeDialog({
  returnRequest,
  onOpenChange,
  restockable,
  onDone,
}: {
  returnRequest: { _id: string; returnNumber: string };
  onOpenChange: (open: boolean) => void;
  /** The returned goods can still go back on the shelf with this. */
  restockable: boolean;
  /** Called with the return as the server left it, after a change. */
  onDone: (updated?: Record<string, unknown>) => void;
}) {
  const [state, setState] = useState<ExchangeState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<ExchangeLineState[]>([]);
  const [delivery, setDelivery] = useState("0");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ExchangeOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState<"save" | "process" | null>(null);
  const [dirty, setDirty] = useState(false);
  const requestRef = useRef(0);
  const returnId = returnRequest._id;

  // What the return stands at now — not what another admin has changed since
  // the list was read.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/returns/${returnId}/exchange`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.message || "");
        if (cancelled) return;
        const loaded = data.data as ExchangeState;
        setState(loaded);
        setLines(toLines(loaded));
        setDelivery(String(loaded.delivery || 0));
      } catch (error) {
        if (!cancelled) {
          setLoadError((error instanceof Error && error.message) || "Could not load the exchange");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [returnId]);

  // The returning seller's products, as the admin types.
  useEffect(() => {
    if (!state?.editable) return;
    const term = search.trim();
    if (!term) return;
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/returns/${returnId}/exchange/products?search=${encodeURIComponent(term)}`,
        );
        const data = await res.json().catch(() => null);
        if (requestId !== requestRef.current) return;
        if (!res.ok || !data?.success) throw new Error(data?.message || "");
        setOptions((data.data as ExchangeOption[]).slice(0, 8));
      } catch (error) {
        if (requestId === requestRef.current) {
          toast.error((error instanceof Error && error.message) || "Products could not be loaded");
        }
      } finally {
        if (requestId === requestRef.current) setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [returnId, search, state?.editable]);

  const currency = state?.currency || "USD";
  const money = (value: number) => {
    const resolved = resolveCurrency(currency);
    return formatCurrency(value, resolved.code, resolved.locale);
  };

  // Priced here as it is edited, the way the server will price it.
  const parsed = lines.map((line) => ({
    unitPrice: Math.max(0, Number(line.unitPrice) || 0),
    quantity: Math.max(0, Math.floor(Number(line.quantity) || 0)),
  }));
  const price = priceExchange({
    lines: parsed,
    taxRate: state?.price.taxRate || 0,
    delivery: Math.max(0, Number(delivery) || 0),
    currency,
  });
  const split = exchangeSplit({ returnLeft: state?.returnLeft || 0, total: price.total, currency });
  const badLine = lines.find((line, index) => {
    const quantity = Number(line.quantity);
    return (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      parsed[index].unitPrice > line.listPrice + 0.005
    );
  });
  const problem =
    state?.blocker ??
    (badLine
      ? `${badLine.name}: send at least one, at no more than ${money(badLine.listPrice)} each.`
      : exchangeItemsProblem(parsed, price.total));

  const addOption = (option: ExchangeOption) => {
    const key = lineKey(option.productId, option.variantId);
    setLines((current) =>
      current.some((line) => line.key === key)
        ? current.map((line) =>
            line.key === key ? { ...line, quantity: String(Number(line.quantity || 0) + 1) } : line,
          )
        : [
            ...current,
            {
              key,
              productId: option.productId,
              variantId: option.variantId,
              name: option.name,
              sku: option.sku,
              quantity: "1",
              unitPrice: String(option.price),
              listPrice: option.price,
            },
          ],
    );
    setDirty(true);
    setSearch("");
    setOptions([]);
  };

  const editLine = (key: string, patch: Partial<ExchangeLineState>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!returnId) return false;
    const res = await fetch(`/api/admin/returns/${returnId}/exchange`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          quantity: Math.floor(Number(line.quantity) || 0),
          unitPrice: quantizeToCurrency(Math.max(0, Number(line.unitPrice) || 0), currency),
        })),
        delivery: Math.max(0, Number(delivery) || 0),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      toast.error(data?.message || "The exchange items could not be saved");
      return false;
    }
    const saved = data.data as ExchangeState;
    setState(saved);
    setLines(toLines(saved));
    setDelivery(String(saved.delivery || 0));
    setDirty(false);
    return true;
  };

  const onSave = async () => {
    setBusy("save");
    try {
      if (await save()) {
        toast.success(lines.length > 0 ? "Exchange items saved" : "Exchange removed");
        onDone();
        onOpenChange(false);
      }
    } finally {
      setBusy(null);
    }
  };

  const onProcess = async () => {
    if (!returnId) return;
    setBusy("process");
    try {
      if (dirty && !(await save())) return;
      const res = await fetch(`/api/admin/returns/${returnId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processExchange: true,
          ...(restockable && restock ? { restoreInventoryOnRefund: true } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.message || "The exchange order could not be made");
        return;
      }
      const made = data.data?.exchangeOrder as { orderNumber?: string; owed?: number } | undefined;
      if (data.data?.payLinkNotSent) {
        toast.warning(
          `Exchange order #${made?.orderNumber} made, but its pay link could not be emailed. Send it from the order page.`,
        );
      } else {
        toast.success(
          made && Number(made.owed || 0) > 0
            ? `Exchange order #${made.orderNumber} made. The shopper was sent a link to pay ${money(Number(made.owed))}.`
            : `Exchange order #${made?.orderNumber} made.`,
        );
      }
      onDone(data.data);
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const editable = Boolean(state?.editable);

  return (
    <Dialog open onOpenChange={(next) => (busy ? null : onOpenChange(next))}>
      <DialogContent className="max-h-[92dvh] grid-cols-1 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Exchange {returnRequest.returnNumber}</DialogTitle>
          <DialogDescription>
            The return pays for a new order with these items. Stock is taken when you make it.
          </DialogDescription>
        </DialogHeader>

        {!state ? (
          <div className="flex justify-center py-8">
            {loadError ? (
              <p className="text-sm text-muted-foreground">{loadError}</p>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4">
            {lines.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {lines.map((line) => (
                  <li key={line.key} className="flex items-center gap-2 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      {Number(line.unitPrice) < line.listPrice - 0.005 ? (
                        <p className="text-xs text-muted-foreground">
                          {money(line.listPrice)} in the catalog
                        </p>
                      ) : line.sku ? (
                        <p className="truncate text-xs text-muted-foreground">{line.sku}</p>
                      ) : null}
                    </div>
                    <Input
                      aria-label={`Quantity of ${line.name}`}
                      type="number"
                      min={1}
                      step={1}
                      className="h-8 w-16"
                      value={line.quantity}
                      disabled={!editable}
                      onChange={(event) => editLine(line.key, { quantity: event.target.value })}
                    />
                    <Input
                      aria-label={`Price of ${line.name}`}
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-8 w-24"
                      value={line.unitPrice}
                      disabled={!editable}
                      onChange={(event) => editLine(line.key, { unitPrice: event.target.value })}
                    />
                    {editable ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Remove ${line.name}`}
                        onClick={() => {
                          setLines((current) => current.filter((item) => item.key !== line.key));
                          setDirty(true);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {editable ? (
              <div className="grid gap-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Add an item from this seller"
                    className="pl-9"
                    aria-label="Search this seller's products"
                  />
                  {searching ? (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
                {search.trim() && options.length > 0 ? (
                  <ul className="divide-y rounded-md border">
                    {options.map((option) => (
                      <li key={option.key}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={option.available === 0}
                          onClick={() => addOption(option)}
                        >
                          <span className="min-w-0 truncate">{option.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {option.available === 0
                              ? "Out of stock"
                              : `${money(option.price)}${
                                  option.available !== null ? ` · ${option.available} left` : ""
                                }`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : search.trim() && !searching ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    Nothing from this seller matches. Pre-orders, downloads and items priced on
                    request can&apos;t be sent as an exchange.
                  </p>
                ) : null}
              </div>
            ) : null}

            {lines.length > 0 ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="exchange-delivery">Delivery charge</Label>
                  <Input
                    id="exchange-delivery"
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-32"
                    value={delivery}
                    disabled={!editable}
                    onChange={(event) => {
                      setDelivery(event.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-muted/50 p-3 text-sm">
                  <dt className="text-muted-foreground">
                    Exchange order{price.tax > 0 ? ` (with ${price.taxRate}% tax)` : ""}
                  </dt>
                  <dd className="text-right">{money(price.total)}</dd>
                  <dt className="text-muted-foreground">The return pays</dt>
                  <dd className="text-right">{money(split.credit)}</dd>
                  {split.owed > 0 ? (
                    <>
                      <dt className="font-medium">The shopper pays, by link</dt>
                      <dd className="text-right font-medium">{money(split.owed)}</dd>
                    </>
                  ) : null}
                  {split.rest > 0 ? (
                    <>
                      <dt className="font-medium">Left to refund</dt>
                      <dd className="text-right font-medium">{money(split.rest)}</dd>
                    </>
                  ) : null}
                </dl>
              </>
            ) : null}

            {restockable && !problem ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={restock} onCheckedChange={(value) => setRestock(value === true)} />
                Put the returned items back in stock
              </label>
            ) : null}

            {problem && (lines.length > 0 || state.blocker) ? (
              <p className="text-sm text-muted-foreground">{problem}</p>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onSave}
            disabled={!state || !editable || !dirty || busy !== null}
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {lines.length === 0 && (state?.items.length || 0) > 0 ? "Remove exchange" : "Save"}
          </Button>
          <Button
            type="button"
            onClick={onProcess}
            disabled={!state || !editable || Boolean(problem) || busy !== null}
          >
            {busy === "process" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Make exchange order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
