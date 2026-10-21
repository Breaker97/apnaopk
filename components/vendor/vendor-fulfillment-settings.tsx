"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import Link from "@/components/language/link";
import { resolveVendorFulfillmentMode, type VendorFulfillmentMode } from "@/lib/vendors/vendor-fulfillment";

export function VendorFulfillmentSettings({
  value,
  onChange,
}: {
  value?: VendorFulfillmentMode;
  onChange: (mode: VendorFulfillmentMode) => void;
}) {
  const tr = useFallbackTranslator(useTranslations());
  const title = tr("vendor.fulfillmentSettings.title", "Order fulfillment");
  const mode = resolveVendorFulfillmentMode(value);
  const options = [
    { value: "delivery" as const, label: tr("vendor.fulfillmentSettings.delivery", "Delivery only") },
    { value: "pickup" as const, label: tr("vendor.fulfillmentSettings.pickup", "Pickup at store only") },
    { value: "both" as const, label: tr("vendor.fulfillmentSettings.both", "Delivery and pickup") },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {tr("vendor.fulfillmentSettings.description", "Choose how customers receive your physical products. You can offer one option or both.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="grid gap-3" aria-label={title}>
          {options.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-lg border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="vendor-fulfillment-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => onChange(option.value)}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm font-medium">{option.label}</span>
            </label>
          ))}
        </fieldset>
        {mode !== "delivery" ? (
          <p className="text-sm text-muted-foreground">
            {tr("vendor.fulfillmentSettings.pickupHint", "Pickup uses your active pickup locations and their available stock. Add a location with an address before saving pickup only.")}{" "}
            <Link href="/vendor/locations" className="font-medium text-primary underline underline-offset-4">
              {tr("vendor.fulfillmentSettings.locations", "Manage pickup locations")}
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
