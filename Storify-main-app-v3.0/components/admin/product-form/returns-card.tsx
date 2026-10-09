"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import type { ProductFormData } from "@/components/admin/product-form/schema";

/**
 * Final sale: shoppers cannot return the product. One switch beside
 * Publishing — like publishing, a yes/no about the product as a whole; a
 * variant can still be set on its own (see VariantEditModal). Below it, the
 * product's own return window (R6); left empty, the store's applies.
 */
export function ReturnsCard({ form }: { form: UseFormReturn<ProductFormData> }) {
  const t = useTranslations();
  const tr = useFallbackTranslator(t);

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{tr("admin.productForm.sections.returns", "Returns")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="returns.finalSale"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <FormLabel>
                  {tr("admin.productForm.fields.finalSale", "Final sale")}
                </FormLabel>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "admin.productForm.finalSaleHelp",
                    "Shoppers can't return it. A variant can be set on its own.",
                  )}
                </p>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="returns.windowDays"
          render={({ field }) => (
            <FormItem className="mt-3 space-y-1.5">
              <FormLabel>
                {tr("admin.productForm.fields.returnWindowDays", "Return window (days)")}
              </FormLabel>
              <FormControl>
                <NumberInput
                  min={1}
                  max={365}
                  step={1}
                  placeholder={tr("admin.productForm.returnWindowStore", "Store default")}
                  value={field.value ?? undefined}
                  onValueChange={(next) => field.onChange(next ?? null)}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "admin.productForm.returnWindowHelp",
                  "Only for this product. Where a collection sets one too, the shorter applies.",
                )}
              </p>
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
