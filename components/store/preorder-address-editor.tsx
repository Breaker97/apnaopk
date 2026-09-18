"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin } from "lucide-react";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { Button } from "@/components/ui/button";
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

/**
 * Change where a waiting pre-order ships.
 *
 * One editor for both ways in — the signed-in shopper's order page, and the
 * manage link a guest gets in their delay notice — so the two can never offer
 * different rules. The rules themselves are the server's
 * (`changePreorderShippingAddress`); this only mirrors the one a shopper would
 * otherwise discover by being refused: the country and region are shown but
 * not editable, because the shipping, tax and duties were priced for them.
 */

type Address = {
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

export function PreorderAddressEditor({
  orderId,
  address,
  accessToken,
  onSaved,
}: {
  orderId: string;
  address: Address;
  /** The manage link, when a guest is editing without an account. */
  accessToken?: string;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const initialName =
    address.fullName ||
    [address.firstName, address.lastName].filter(Boolean).join(" ");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: initialName,
    street: address.street || "",
    apartment: address.apartment || "",
    city: address.city || "",
    postalCode: address.postalCode || "",
    phone: address.phone || "",
  });

  const set = (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));

  const openEditor = () => {
    // Reopened from the address as it stands now, not from a half-typed
    // attempt the shopper walked away from.
    setForm({
      fullName: initialName,
      street: address.street || "",
      apartment: address.apartment || "",
      city: address.city || "",
      postalCode: address.postalCode || "",
      phone: address.phone || "",
    });
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/preorder-address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          address: {
            ...form,
            apartment: form.apartment || undefined,
            phone: form.phone || undefined,
            // Sent so the server can refuse a mismatch; it writes its own.
            country: address.country || "",
            state: address.state || "",
          },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const fieldErrors = json?.errors as Record<string, string[]> | undefined;
        const firstFieldError = fieldErrors
          ? Object.values(fieldErrors).flat()[0]
          : undefined;
        throw new Error(
          firstFieldError ||
            json?.message ||
            tf("orders.preorderAddress.failed", "The address could not be updated"),
        );
      }
      toast.success(
        tf("orders.preorderAddress.saved", "Delivery address updated"),
      );
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tf("orders.preorderAddress.failed", "The address could not be updated"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={openEditor}>
        <MapPin className="mr-2 h-4 w-4" />
        {tf("orders.preorderAddress.change", "Change delivery address")}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tf("orders.preorderAddress.title", "Change delivery address")}
            </DialogTitle>
            <DialogDescription>
              {tf(
                "orders.preorderAddress.description",
                "You can change this until your pre-order ships. The country and region stay as they are, because shipping was priced for them.",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="preorder-address-name">
                {tf("checkout.fullName", "Full name")}
              </Label>
              <Input
                id="preorder-address-name"
                value={form.fullName}
                onChange={set("fullName")}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preorder-address-street">
                {tf("checkout.address", "Street address")}
              </Label>
              <Input
                id="preorder-address-street"
                value={form.street}
                onChange={set("street")}
                autoComplete="address-line1"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preorder-address-apartment">
                {tf("checkout.apartment", "Apartment, suite, etc. (optional)")}
              </Label>
              <Input
                id="preorder-address-apartment"
                value={form.apartment}
                onChange={set("apartment")}
                autoComplete="address-line2"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="preorder-address-city">
                  {tf("checkout.city", "City")}
                </Label>
                <Input
                  id="preorder-address-city"
                  value={form.city}
                  onChange={set("city")}
                  autoComplete="address-level2"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="preorder-address-postal">
                  {tf("checkout.postalCode", "Postal code")}
                </Label>
                <Input
                  id="preorder-address-postal"
                  value={form.postalCode}
                  onChange={set("postalCode")}
                  autoComplete="postal-code"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="preorder-address-phone">
                {tf("checkout.phone", "Phone")}
              </Label>
              <Input
                id="preorder-address-phone"
                value={form.phone}
                onChange={set("phone")}
                autoComplete="tel"
              />
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {[address.state, address.country].filter(Boolean).join(", ")}
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              {tf("common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {tf("orders.preorderAddress.save", "Save address")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
