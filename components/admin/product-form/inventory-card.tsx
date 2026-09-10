"use client";

import type { Dispatch, SetStateAction } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LocationInventoryManager } from "@/components/admin/location-inventory";
import type { LocationInventory } from "@/types";
import type { ProductFormData } from "@/components/admin/product-form/schema";

interface InventoryCardProps {
  form: UseFormReturn<ProductFormData>;
  hasVariants: boolean;
  variantCount: number;
  variantTotalStock: number;
  activeLocations: { _id: string; name: string; isDefault?: boolean }[];
  productLocationInventory: LocationInventory[];
  setProductLocationInventory: Dispatch<SetStateAction<LocationInventory[]>>;
  /** Adds a location created inline to the form's own list. */
  onLocationCreated: (location: { _id: string; name: string }) => void;
  /** From the form options payload; false hides the inline create control. */
  canManageLocations?: boolean;
}

export function InventoryCard({
  form,
  hasVariants,
  variantCount,
  variantTotalStock,
  activeLocations,
  productLocationInventory,
  setProductLocationInventory,
  onLocationCreated,
  canManageLocations = true,
}: InventoryCardProps) {
  const t = useTranslations();

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>
          {t("admin.productForm.sections.inventory")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasVariants && (
          <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm">
            <div className="font-medium text-foreground">
              {t("admin.productForm.variantInventoryTitle")}
            </div>
            <div className="mt-1 text-muted-foreground">
              {t("admin.productForm.variantInventorySummary", {
                total: variantTotalStock,
                count: variantCount,
              })}
            </div>
          </div>
        )}

        {!hasVariants && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="inventory.sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("admin.productForm.fields.sku")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "admin.productForm.placeholders.sku",
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="inventory.barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("admin.productForm.fields.barcode")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "admin.productForm.placeholders.barcode",
                        )}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="inventory.barcodeFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Barcode standard</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="auto">Auto-detect</SelectItem>
                        <SelectItem value="ean13">EAN-13 / GTIN-13</SelectItem>
                        <SelectItem value="upca">UPC-A / GTIN-12</SelectItem>
                        <SelectItem value="gtin14">GTIN-14</SelectItem>
                        <SelectItem value="code128">Code 128 (internal)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="inventory.barcodeSource"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Identifier source</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="unspecified">Not specified</SelectItem>
                        <SelectItem value="manufacturer">Manufacturer assigned</SelectItem>
                        <SelectItem value="gs1">GS1 issued</SelectItem>
                        <SelectItem value="internal">Internal store code</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Amazon, Walmart and eBay identifiers must be manufacturer or GS1 issued.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {activeLocations.length === 0 ? (
              // No locations configured — fall back to a simple quantity field.
              <FormField
                control={form.control}
                name="inventory.quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("admin.productForm.fields.quantity")}
                    </FormLabel>
                    <FormControl>
                      <NumberInput
                        placeholder="0"
                        min={0}
                        step={1}
                        {...field}
                        whenEmpty={0}
                        normalize={Math.trunc}
                        onValueChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : activeLocations.length === 1 ? (
              // Single location — show a normal quantity input that
              // writes through to that one location.
              <FormItem>
                <FormLabel>
                  {t("admin.productForm.fields.quantity")}
                </FormLabel>
                <FormControl>
                  <NumberInput
                    placeholder="0"
                    min={0}
                    step={1}
                    value={productLocationInventory[0]?.quantity ?? 0}
                    whenEmpty={0}
                    normalize={Math.trunc}
                    onValueChange={(next) => {
                      const qty = next ?? 0;
                      const loc = activeLocations[0];
                      setProductLocationInventory([
                        {
                          locationId: loc._id,
                          locationName: loc.name,
                          quantity: qty,
                        },
                      ]);
                      // Mirror to the legacy form field so any
                      // downstream logic that reads it still works.
                      form.setValue("inventory.quantity", qty, {
                        shouldDirty: true,
                      });
                    }}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  {t("admin.productForm.stockedAt", {
                    location: activeLocations[0].name,
                  })}
                </p>
              </FormItem>
            ) : (
              // 2+ locations — show per-location editor inline.
              <LocationInventoryManager
                // The form already has these from its options payload, so the
                // manager must not fetch them again.
                locations={activeLocations}
                canCreate={canManageLocations}
                onLocationCreated={onLocationCreated}
                value={productLocationInventory}
                onChange={(val) => {
                  setProductLocationInventory(val);
                  const total = val.reduce(
                    (s, l) => s + (l.quantity || 0),
                    0,
                  );
                  form.setValue("inventory.quantity", total, {
                    shouldDirty: true,
                  });
                }}
              />
            )}
          </>
        )}

        <FormField
          control={form.control}
          name="inventory.tracked"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <FormLabel>
                {t("admin.productForm.fields.trackQuantity")}
              </FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="inventory.continueSellingWhenOutOfStock"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <FormLabel>
                {t("admin.productForm.fields.continueSelling")}
              </FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
