"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";

/**
 * Correcting a delivery address a courier could not deliver to.
 *
 * One form for every way in — staff on the order page, the signed-in customer,
 * and a guest holding the address link — so none of them can offer different
 * rules. The rules are the server's (`changeOrderShippingAddress`): the country
 * and region are shown but locked, because shipping and tax were priced for
 * them; and an address the courier still can't find is not saved — the reasons
 * come back, with a suggestion to use when the carrier offered one.
 */

export type CorrectableAddress = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  street?: string;
  apartment?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
};

type Verification = {
  verdict: "valid" | "invalid" | "unknown";
  messages: string[];
  suggestion?: { street: string; apartment?: string; city: string; postalCode: string };
  /** "format" when no courier was asked — a missing field, a malformed postcode. */
  checkedWith?: "format" | "carrier";
};

type SaveResponse =
  | { saved: true; released: boolean; verification: Verification }
  | { saved: false; verification: Verification };

export function AddressCorrectionForm(props: {
  endpoint: string;
  address: CorrectableAddress;
  /** Sent with every request — the signed link for a guest. */
  extraBody?: Record<string, unknown>;
  /** Staff may save an address the check could not confirm. */
  allowForce?: boolean;
  submitLabel?: string;
  onSaved: (result: { released: boolean }) => void;
  onCancel?: () => void;
  /** Shown beside Save, e.g. "My address is correct" for a customer. */
  secondaryAction?: React.ReactNode;
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const initialName =
    props.address.fullName ||
    [props.address.firstName, props.address.lastName].filter(Boolean).join(" ");

  const [form, setForm] = useState({
    fullName: initialName,
    street: props.address.street || "",
    apartment: props.address.apartment || "",
    city: props.address.city || "",
    postalCode: props.address.postalCode || "",
    phone: props.address.phone || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Verification | null>(null);

  const set = (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
      // A refusal was about the address as it was; an edit makes it stale.
      setRefusal(null);
    };

  const save = async (force = false) => {
    setSaving(true);
    setError(null);
    try {
      const result = await apiClient.post<SaveResponse>(props.endpoint, {
        ...(props.extraBody || {}),
        ...(force ? { force: true } : {}),
        address: {
          ...form,
          apartment: form.apartment || undefined,
          phone: form.phone || undefined,
          // Sent so the server can refuse a mismatch; it writes its own.
          country: props.address.country || "",
          state: props.address.state || "",
        },
      });
      if (!result.saved) {
        setRefusal(result.verification);
        return;
      }
      setRefusal(null);
      props.onSaved({ released: result.released });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : tf("orders.addressHold.saveFailed", "The address could not be updated"),
      );
    } finally {
      setSaving(false);
    }
  };

  const useSuggestion = () => {
    const suggestion = refusal?.suggestion;
    if (!suggestion) return;
    setForm((current) => ({
      ...current,
      street: suggestion.street,
      apartment: suggestion.apartment || current.apartment,
      city: suggestion.city,
      postalCode: suggestion.postalCode,
    }));
    setRefusal(null);
  };

  const field = (
    key: keyof typeof form,
    label: string,
    options: { optional?: boolean; wide?: boolean; autoComplete?: string } = {},
  ) => (
    <div className={`space-y-1.5 ${options.wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={`address-${key}`}>
        {label}
        {options.optional ? (
          <span className="ml-1 font-normal text-muted-foreground">
            {tf("orders.addressHold.optional", "(optional)")}
          </span>
        ) : null}
      </Label>
      <Input
        id={`address-${key}`}
        value={form[key]}
        onChange={set(key)}
        autoComplete={options.autoComplete}
      />
    </div>
  );

  const locked = (id: string, label: string, value?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div
        id={id}
        className="flex h-9 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground"
      >
        <span className="truncate">{value || "—"}</span>
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {refusal ? (
        <div role="alert" className="space-y-3 rounded-md border-l-2 border-destructive bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {refusal.checkedWith === "carrier"
                ? tf("orders.addressHold.stillUndeliverable", "The courier still can't find this address")
                : tf("orders.addressHold.checkAddress", "Check this address")}
              {refusal.messages.length ? `: ${refusal.messages.join("; ")}` : "."}
            </span>
          </p>
          {refusal.suggestion ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background p-2.5 text-sm">
              <span>
                <span className="text-muted-foreground">
                  {tf("orders.addressHold.didYouMean", "Did you mean")}{" "}
                </span>
                {[refusal.suggestion.street, refusal.suggestion.city, refusal.suggestion.postalCode].join(", ")}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={useSuggestion}>
                {tf("orders.addressHold.useSuggestion", "Use this address")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("fullName", tf("orders.addressHold.fullName", "Full name"), { wide: true, autoComplete: "name" })}
        {field("street", tf("orders.addressHold.street", "Street address"), { wide: true, autoComplete: "address-line1" })}
        {field("apartment", tf("orders.addressHold.apartment", "Apartment, suite"), { wide: true, optional: true, autoComplete: "address-line2" })}
        {field("city", tf("orders.addressHold.city", "City"), { autoComplete: "address-level2" })}
        {field("postalCode", tf("orders.addressHold.postalCode", "Postal code"), { autoComplete: "postal-code" })}
        {locked("address-state", tf("orders.addressHold.state", "State / region"), props.address.state)}
        {locked("address-country", tf("orders.addressHold.country", "Country"), props.address.country)}
        {field("phone", tf("orders.addressHold.phone", "Phone"), { wide: true, optional: true, autoComplete: "tel" })}
      </div>
      <p className="text-xs text-muted-foreground">
        {tf(
          "orders.addressHold.lockedHint",
          "The country and region can't change here — delivery and tax were priced for them.",
        )}
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {props.secondaryAction}
          {props.allowForce && refusal ? (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void save(true)}>
              {tf("orders.addressHold.saveAnyway", "Save anyway")}
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          {props.onCancel ? (
            <Button type="button" variant="outline" disabled={saving} onClick={props.onCancel}>
              {tf("common.cancel", "Cancel")}
            </Button>
          ) : null}
          <Button type="button" disabled={saving} onClick={() => void save(false)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {props.submitLabel || tf("orders.addressHold.save", "Save address")}
          </Button>
        </div>
      </div>
    </div>
  );
}
