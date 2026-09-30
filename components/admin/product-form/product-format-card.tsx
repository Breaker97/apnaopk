"use client";

import { useTranslations } from "next-intl";
import { FileDown, Package } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import type { ProductFormData } from "@/components/admin/product-form/schema";

/**
 * Physical/Digital selector. UI sugar over `shipping.isPhysicalProduct` —
 * the same flag Shopify exposes as "This is a physical product" — surfaced
 * at the top of the form because it decides which sections apply (Shipping
 * for physical, Digital files for digital).
 *
 * Chosen once, at creation, so only the create page renders it: the two
 * formats own different data (weight/customs vs. download files), different
 * checkout paths and different stock semantics, and existing carts and orders
 * already reference the old shape. The API refuses the switch too — see
 * isProductFormatChange() in lib/catalog/product-shipping.ts.
 *
 * `formats` is what the store sells (Settings → Products). A new product is
 * offered only those, and with a single one there is nothing to choose, so
 * the card steps aside — the form already starts in that format.
 */
export function ProductFormatCard({
  form,
  formats,
}: {
  form: UseFormReturn<ProductFormData>;
  formats: { physical: boolean; digital: boolean };
}) {
  const t = useTranslations();

  if (!(formats.physical && formats.digital)) return null;

  const options = [
    {
      physical: true,
      icon: Package,
      title: t("admin.productForm.fields.physicalProduct"),
      description: t("admin.productForm.format.physicalHelp"),
    },
    {
      physical: false,
      icon: FileDown,
      title: t("admin.productForm.format.digital"),
      description: t("admin.productForm.format.digitalHelp"),
    },
  ];

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{t("admin.productForm.sections.format")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="shipping.isPhysicalProduct"
          render={({ field }) => (
            <div
              role="radiogroup"
              aria-label={t("admin.productForm.sections.format")}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {options.map((option) => {
                const isSelected = (field.value ?? true) === option.physical;
                return (
                  <button
                    key={String(option.physical)}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      if (isSelected) return;
                      field.onChange(option.physical);
                      // The Inventory card is hidden for digital products, so
                      // stock tracking must not stay on (the tracked:true +
                      // quantity:0 defaults would make them unsellable).
                      form.setValue("inventory.tracked", option.physical, {
                        shouldDirty: true,
                      });
                    }}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-muted-foreground/50",
                    )}
                  >
                    <option.icon
                      className={cn(
                        "mt-0.5 h-5 w-5 shrink-0",
                        isSelected ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
