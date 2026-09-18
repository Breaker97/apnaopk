"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import {
  downloadBlob,
  fetchLabelBlob,
  printLabelBlob,
} from "./carrier-label-actions";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/**
 * The manual "Send to courier" flow, shared by the admin and vendor order
 * screens.
 *
 * Parameterised by `apiBase` rather than duplicated: the two order-detail
 * components already carry ~1000 lines each, and a third copy of a
 * money-spending flow would be the one that drifts.
 */

/** A consignment the caller may hand to a courier. */
export interface CourierConsignment {
  id: string;
  label: string;
}

export interface CourierPackagePreset {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  dimensionUnit: "cm" | "in";
  active?: boolean;
}

interface Quote {
  provider: string;
  rateId: string;
  carrierName: string;
  serviceName: string;
  serviceToken?: string;
  amount: number;
  currency: string;
  estimatedDays?: number;
  attributes?: string[];
}

interface Parcel {
  length: number;
  width: number;
  height: number;
  dimensionUnit: "cm" | "in";
  weight: number;
  weightUnit: "g" | "kg" | "lb" | "oz";
}

interface RatesResponse {
  shipmentId: string;
  provider?: string;
  mode?: "test" | "live";
  quotes: Quote[];
  parcel: Parcel;
  packing: { strategy: string; warnings: string[]; boxId?: string };
}

type Step = "package" | "quotes" | "done";

/**
 * The "let the packer choose" option. A Select item cannot carry an empty
 * value, and without an item of its own the placeholder was a state a merchant
 * could leave but never return to.
 */
const AUTO_PACKAGE = "__auto__";

const PARCEL_FIELDS = ["length", "width", "height", "weight"] as const;

const WARNING_COPY: Record<string, string> = {
  MISSING_WEIGHT:
    "Some items have no weight — a minimum weight was used, so the quote may be low.",
  MISSING_DIMENSIONS:
    "Some items have no size — the default box was used instead of a tighter one.",
  NO_PACKAGE_PRESET:
    "No saved packages exist, so a standard box was assumed. Add one in Settings → Shipping.",
  OVERWEIGHT:
    "This consignment is heavier than every saved box. The carrier may reject it.",
};

export function SendToCourierDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiBase: "/api/admin" | "/api/vendor";
  orderId: string;
  orderNumber: string;
  subOrderId?: string;
  /**
   * The consignments still waiting for a courier.
   *
   * A split order has several, and the rate route cannot guess which parcel is
   * meant — it refused the whole order rather than pick one, which is what took
   * the Shipments panel away from every split order. A vendor sees exactly one,
   * so nothing is asked of them.
   */
  consignments?: CourierConsignment[];
  packages: CourierPackagePreset[];
  storeCurrency?: string;
  /** Refresh the order + shipments list once a label exists. */
  onPurchased?: () => void;
}) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);

  const [step, setStep] = useState<Step>("package");
  const [isBusy, setIsBusy] = useState(false);
  const [consignmentId, setConsignmentId] = useState<string>("");
  const [packageId, setPackageId] = useState<string>("");
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [selectedRateId, setSelectedRateId] = useState<string>("");
  /**
   * Why the last attempt failed, shown in the dialog rather than a toast.
   *
   * A carrier's refusal is not a one-liner: Shippo answers an unserviceable
   * lane with a reason per carrier account, and even summarised that is a
   * paragraph. A toast rendered it as an unreadable slab over the page and then
   * timed out, while the dialog the merchant was looking at said nothing. Here
   * it sits next to the box they would adjust and stays until they retry.
   */
  const [error, setError] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<{
    trackingNumber?: string;
    carrier?: string;
    trackingUrl?: string;
    shipmentId: string;
  } | null>(null);

  const activePackages = props.packages.filter((preset) => preset.active !== false);
  // Every carrier refuses a zero dimension or weight, and so does the rate
  // route. Caught here it is named beside the field; left to the server it came
  // back as one generic validation error for the whole form.
  const invalidParcelFields = parcel
    ? PARCEL_FIELDS.filter((field) => !(Number(parcel[field]) > 0))
    : [];
  const choices = props.consignments || [];
  // The vendor route pins the consignment server-side, so its prop wins. A
  // single choice needs no asking; the first one is simply it.
  const subOrderId = props.subOrderId ?? (consignmentId || choices[0]?.id);

  // Reopening must not show the previous order's quotes.
  useApplyOnChange([props.open], () => {
    if (props.open) return;
    setStep("package");
    setRates(null);
    setSelectedRateId("");
    setPurchased(null);
    setParcel(null);
    setConsignmentId("");
    setError(null);
  });

  const fetchRates = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await apiClient.post<RatesResponse>(
        `${props.apiBase}/orders/${props.orderId}/shipments/rates`,
        {
          subOrderId: subOrderId || undefined,
          packageId: packageId || undefined,
          parcel: parcel ?? undefined,
        },
      );
      setRates(result);
      setParcel(result.parcel);
      // `rateShopSubOrder` sorts cheapest-first before storing the quotes, so
      // the first row is genuinely the cheapest and is safe to pre-select.
      // Neither carrier orders its own rate list, so this default is only
      // honest because the server imposes one.
      setSelectedRateId(result.quotes[0]?.rateId || "");
      setStep("quotes");
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : tSafe("admin.orderDetails.courier.noRates", "No rates available"),
      );
    } finally {
      setIsBusy(false);
    }
  }, [packageId, parcel, props.apiBase, props.orderId, subOrderId, tSafe]);

  const buyLabel = useCallback(async () => {
    if (!rates || !selectedRateId) return;
    const quote = rates.quotes.find((entry) => entry.rateId === selectedRateId);
    setIsBusy(true);
    setError(null);
    try {
      const shipment = await apiClient.post<{
        _id: string;
        trackingNumber?: string;
        carrier?: string;
        trackingUrl?: string;
      }>(
        `${props.apiBase}/orders/${props.orderId}/shipments/${rates.shipmentId}/purchase`,
        { rateId: selectedRateId, serviceToken: quote?.serviceToken },
      );
      setPurchased({
        shipmentId: rates.shipmentId,
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier,
        trackingUrl: shipment.trackingUrl,
      });
      setStep("done");
      props.onPurchased?.();
      toast.success(
        tSafe("admin.orderDetails.courier.purchased", "Shipping label purchased"),
      );
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : tSafe("admin.orderDetails.courier.buyFailed", "Could not buy the label"),
      );
    } finally {
      setIsBusy(false);
    }
  }, [props, rates, selectedRateId, tSafe]);

  const withLabel = useCallback(
    async (action: (blob: Blob) => void | Promise<void>) => {
      if (!purchased) return;
      setIsBusy(true);
      try {
        const blob = await fetchLabelBlob(
          `${props.apiBase}/orders/${props.orderId}/shipments/${purchased.shipmentId}/label`,
        );
        await action(blob);
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : tSafe(
                "admin.orderDetails.shippingLabelFailed",
                "Could not download the label",
              ),
        );
      } finally {
        setIsBusy(false);
      }
    },
    [props.apiBase, props.orderId, purchased, tSafe],
  );

  const updateParcel = (patch: Partial<Parcel>) => {
    setParcel((current) =>
      current
        ? { ...current, ...patch }
        : {
            length: 0,
            width: 0,
            height: 0,
            dimensionUnit: "cm",
            weight: 0,
            weightUnit: "kg",
            ...patch,
          },
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tSafe("admin.orderDetails.courier.sendToCourier", "Send to courier")}
          </DialogTitle>
          <DialogDescription>
            {props.orderNumber}
          </DialogDescription>
        </DialogHeader>

        {step === "package" ? (
          <div className="space-y-4">
            {/* Only when there is genuinely a choice. One consignment is not a
                decision, and asking for it would put a form in front of every
                single-seller order. */}
            {!props.subOrderId && choices.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="courier-consignment">
                  {tSafe(
                    "admin.orderDetails.courier.selectConsignment",
                    "Consignment",
                  )}
                </Label>
                <Select
                  value={subOrderId || ""}
                  onValueChange={(value) => {
                    setConsignmentId(value);
                    // Another seller's parcel holds other goods, so neither the
                    // worked-out box nor the last refusal describes it.
                    setParcel(null);
                    setError(null);
                  }}
                >
                  <SelectTrigger id="courier-consignment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((consignment) => (
                      <SelectItem key={consignment.id} value={consignment.id}>
                        {consignment.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {activePackages.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="courier-package">
                  {tSafe(
                    "admin.orderDetails.courier.selectPackage",
                    "Package",
                  )}
                </Label>
                <Select
                  value={packageId || AUTO_PACKAGE}
                  onValueChange={(value) => {
                    setPackageId(value === AUTO_PACKAGE ? "" : value);
                    // A different box means the previous parcel no longer
                    // describes what is being shipped.
                    setParcel(null);
                    // ...nor does the last refusal necessarily still apply.
                    setError(null);
                  }}
                >
                  <SelectTrigger id="courier-package">
                    <SelectValue
                      placeholder={tSafe(
                        "admin.orderDetails.courier.autoPackage",
                        "Choose automatically",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_PACKAGE}>
                      {tSafe(
                        "admin.orderDetails.courier.autoPackage",
                        "Choose automatically",
                      )}
                    </SelectItem>
                    {activePackages.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name} — {preset.length}×{preset.width}×
                        {preset.height} {preset.dimensionUnit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {parcel ? (
              <div className="grid grid-cols-2 gap-3">
                {PARCEL_FIELDS.map((field) => (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={`courier-${field}`} className="capitalize">
                      {field}{" "}
                      <span className="text-muted-foreground">
                        (
                        {field === "weight"
                          ? parcel.weightUnit
                          : parcel.dimensionUnit}
                        )
                      </span>
                    </Label>
                    <NumberInput
                      id={`courier-${field}`}
                      min={0}
                      step="0.01"
                      value={parcel[field]}
                      whenEmpty={0}
                      aria-invalid={invalidParcelFields.includes(field)}
                      aria-describedby={
                        invalidParcelFields.includes(field)
                          ? `courier-${field}-error`
                          : undefined
                      }
                      onValueChange={(next) => updateParcel({ [field]: next ?? 0 })}
                    />
                    {invalidParcelFields.includes(field) ? (
                      <p
                        id={`courier-${field}-error`}
                        className="text-xs text-destructive"
                      >
                        {tSafe(
                          "admin.orderDetails.courier.mustBePositive",
                          "Must be more than 0",
                        )}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {tSafe(
                  "admin.orderDetails.courier.packageHint",
                  "The parcel is worked out from the items' weight and size. Fetch rates to see it, then adjust if you know better.",
                )}
              </p>
            )}
          </div>
        ) : null}

        {step === "quotes" && rates ? (
          <div className="space-y-4">
            {rates.packing.warnings.length > 0 ? (
              <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                {rates.packing.warnings.map((warning) => (
                  <p
                    key={warning}
                    className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {WARNING_COPY[warning] || warning}
                  </p>
                ))}
              </div>
            ) : null}

            <RadioGroup value={selectedRateId} onValueChange={setSelectedRateId}>
              <div className="space-y-2">
                {rates.quotes.map((quote) => (
                  <Label
                    key={quote.rateId}
                    htmlFor={`rate-${quote.rateId}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[:checked]:border-primary"
                  >
                    <RadioGroupItem id={`rate-${quote.rateId}`} value={quote.rateId} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {quote.carrierName} · {quote.serviceName}
                        </span>
                        {(quote.attributes || []).map((attribute) => (
                          <Badge key={attribute} variant="secondary" className="text-[10px]">
                            {attribute}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {quote.estimatedDays
                          ? `${quote.estimatedDays} ${tSafe("checkout.days", "days")}`
                          : tSafe(
                              "admin.orderDetails.courier.noEta",
                              "No estimate",
                            )}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatCurrency(quote.amount, quote.currency)}
                    </span>
                  </Label>
                ))}
              </div>
            </RadioGroup>

            {rates.quotes.some(
              (quote) =>
                props.storeCurrency &&
                quote.currency !== props.storeCurrency.toUpperCase(),
            ) ? (
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.orderDetails.courier.currencyMismatch",
                  "Carrier rates are billed to your carrier account in its own currency, not the store's. They are not added to the order total.",
                )}
              </p>
            ) : null}

            {rates.mode === "test" ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {tSafe(
                  "admin.orderDetails.courier.testMode",
                  "Test mode — this label is not real and cannot be used to ship.",
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "done" && purchased ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {tSafe("admin.orderDetails.trackingNumber", "Tracking number")}
              </p>
              <p className="font-mono text-sm font-semibold">
                {purchased.trackingNumber}
              </p>
              <p className="text-xs text-muted-foreground">{purchased.carrier}</p>
            </div>
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={() =>
                  void withLabel((blob) =>
                    downloadBlob(blob, `shipping-label-${props.orderNumber}.pdf`),
                  )
                }
              >
                {tSafe("admin.orderDetails.shippingLabelDownload", "Download label")}
              </Button>
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={() => void withLabel(printLabelBlob)}
              >
                <Printer className="h-4 w-4" />
                {tSafe("admin.orderDetails.printThermalLabel", "Print label")}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            // Capped and scrollable rather than clamped: a carrier's reason can
            // run to a paragraph, and truncating it would hide the one sentence
            // that names the problem.
            className="max-h-40 overflow-y-auto rounded-md border border-red-500/40 bg-red-500/5 p-3"
          >
            <p className="flex items-start gap-2 text-xs leading-relaxed text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </p>
          </div>
        ) : null}

        <DialogFooter>
          {step === "package" ? (
            <Button
              disabled={isBusy || invalidParcelFields.length > 0}
              onClick={() => void fetchRates()}
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Truck className="h-4 w-4" />
              )}
              {tSafe("admin.orderDetails.courier.fetchRates", "Get rates")}
            </Button>
          ) : null}

          {step === "quotes" ? (
            <>
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={() => {
                  setStep("package");
                  // A failed purchase is about the rate that was chosen, not
                  // about the box. Carried back it reads as a complaint against
                  // the form it is now sitting under.
                  setError(null);
                }}
              >
                {tSafe("admin.orderDetails.courier.back", "Back")}
              </Button>
              <Button
                disabled={isBusy || !selectedRateId}
                onClick={() => void buyLabel()}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {tSafe("admin.orderDetails.courier.buyLabel", "Buy label")}
              </Button>
            </>
          ) : null}

          {step === "done" ? (
            <Button onClick={() => props.onOpenChange(false)}>
              {tSafe("common.close", "Close")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
