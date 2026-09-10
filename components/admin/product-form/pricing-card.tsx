"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWatch } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";
import { HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyNumberInput } from "@/components/ui/currency-input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getUnitGroup,
  toReferenceAmount,
  type ProductFormData,
  type UnitPriceDraft,
  type UnitPriceMeasureUnit,
  type UnitPriceSnapshot,
} from "@/components/admin/product-form/schema";

interface PricingCardProps {
  form: UseFormReturn<ProductFormData>;
  currencySymbol: string;
  hasVariants: boolean;
  variantCount: number;
  variantPriceRange: { min: number; max: number } | null;
  watchedUnitPrice: UnitPriceDraft;
  watchedPrice: number;
  watchedProfit: number | undefined;
  watchedMargin: number | undefined;
  pricingAccordionValue: string;
  setPricingAccordionValue: (value: string) => void;
  unitPricePopoverOpen: boolean;
  setUnitPricePopoverOpen: (open: boolean) => void;
}

export function PricingCard({
  form,
  currencySymbol,
  hasVariants,
  variantCount,
  variantPriceRange,
  watchedUnitPrice,
  watchedPrice,
  watchedProfit,
  watchedMargin,
  pricingAccordionValue,
  setPricingAccordionValue,
  unitPricePopoverOpen,
  setUnitPricePopoverOpen,
}: PricingCardProps) {
  const t = useTranslations();
  const [unitPriceSnapshot, setUnitPriceSnapshot] =
    useState<UnitPriceSnapshot>();
  const watchedChargeTax =
    useWatch({ control: form.control, name: "pricing.chargeTax" }) ?? true;
  // "Price on request" hides every price input on this card rather than
  // disabling them: none of those numbers reach a shopper while it is on, so
  // leaving them on screen would only invite the merchant to tune figures
  // nobody will ever see. Their stored values survive the toggle, so turning
  // it back off restores the pricing exactly as it was.
  const watchedPriceOnRequest =
    useWatch({ control: form.control, name: "pricing.priceOnRequest" }) ?? false;
  const watchedUnitPriceTotalAmount =
    useWatch({
      control: form.control,
      name: "pricing.unitPrice.totalAmount",
    }) ?? 0;
  const watchedUnitPriceTotalUnit =
    useWatch({
      control: form.control,
      name: "pricing.unitPrice.totalUnit",
    }) || "g";
  const watchedUnitPriceBaseAmount =
    useWatch({
      control: form.control,
      name: "pricing.unitPrice.baseAmount",
    }) ?? 1;
  const watchedUnitPriceBaseUnit =
    useWatch({
      control: form.control,
      name: "pricing.unitPrice.baseUnit",
    }) || "kg";

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>
          {t("admin.productForm.sections.pricing")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {watchedPriceOnRequest ? (
          <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm">
            <div className="font-medium text-foreground">
              {t("admin.productForm.quote.hiddenPricingTitle")}
            </div>
            <div className="mt-1 text-muted-foreground">
              {t("admin.productForm.quote.hiddenPricingHelp")}
            </div>
          </div>
        ) : hasVariants ? (
          <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm">
            <div className="font-medium text-foreground">
              {t("admin.productForm.variantPricingTitle")}
            </div>
            <div className="mt-1 text-muted-foreground">
              {variantPriceRange && variantPriceRange.min !== Infinity
                ? variantPriceRange.min === variantPriceRange.max
                  ? `${currencySymbol}${variantPriceRange.min.toFixed(2)} across ${variantCount} variant${variantCount === 1 ? "" : "s"}`
                  : `${currencySymbol}${variantPriceRange.min.toFixed(2)} – ${currencySymbol}${variantPriceRange.max.toFixed(2)} across ${variantCount} variants`
                : `Set prices for each of your ${variantCount} variant${variantCount === 1 ? "" : "s"} in the Variants section below.`}
            </div>
          </div>
        ) : (
          <>
        <FormField
          control={form.control}
          name="pricing.price"
          render={({ field }) => (
            <FormItem className="max-w-sm">
              <FormLabel>
                {t("admin.productForm.fields.price")}{" "}
                *
              </FormLabel>
              <FormControl>
                <CurrencyNumberInput
                  currencySymbol={currencySymbol}
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  {...field}
                  whenEmpty={0}
                  onValueChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator />

        <Accordion
          type="single"
          collapsible
          value={pricingAccordionValue}
          onValueChange={(val) => setPricingAccordionValue(val || "")}
          className="-mx-6"
        >
          <AccordionItem
            value="additional-display-prices"
            className="border-0"
          >
            <AccordionTrigger className="px-6 py-3 hover:no-underline">
              {pricingAccordionValue === "additional-display-prices" ? (
                <span className="text-sm font-medium">
                  {t("admin.productForm.additionalDisplayPrices")}
                </span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {t("admin.productForm.fields.compareAt")}
                  </span>
                  <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {t("admin.productForm.fields.unitPrice")}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {t("admin.productForm.fields.chargeTax")}{" "}
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {watchedChargeTax
                        ? t("common.yes")
                        : t("common.no")}
                    </span>
                  </span>
                  <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {t("admin.productForm.fields.costPerItem")}
                  </span>
                </div>
              )}
            </AccordionTrigger>

            <AccordionContent className="px-6 pt-2 pb-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="pricing.comparePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        {t("admin.productForm.fields.compareAtPrice")}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center text-muted-foreground hover:text-foreground"
                            >
                              <HelpCircle className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={6}>
                            {t("admin.productForm.compareAtHelp")}
                          </TooltipContent>
                        </Tooltip>
                      </FormLabel>
                      <FormControl>
                        <CurrencyNumberInput
                          currencySymbol={currencySymbol}
                          step="0.01"
                          min={0}
                          placeholder="0.00"
                          {...field}
                          onValueChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2">
                  <FormLabel>
                    {t("admin.productForm.fields.unitPrice")}
                  </FormLabel>
                  <Popover
                    open={unitPricePopoverOpen}
                    onOpenChange={(open) => {
                      if (open) {
                        setUnitPriceSnapshot({
                          unitPrice:
                            form.getValues("pricing.unitPrice"),
                          unitPriceUnit: form.getValues(
                            "pricing.unitPriceUnit",
                          ),
                        });
                        if (!form.getValues("pricing.unitPrice")) {
                          form.setValue(
                            "pricing.unitPrice",
                            {
                              totalAmount: 0,
                              totalUnit: "g",
                              baseAmount: 1,
                              baseUnit: "kg",
                            },
                            { shouldDirty: true },
                          );
                        }
                      }
                      setUnitPricePopoverOpen(open);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between font-normal"
                      >
                        {(() => {
                          if (
                            !watchedUnitPrice ||
                            watchedUnitPrice.totalAmount <= 0
                          )
                            return "--";
                          const groupA = getUnitGroup(
                            watchedUnitPrice.totalUnit,
                          );
                          const groupB = getUnitGroup(
                            watchedUnitPrice.baseUnit,
                          );
                          if (groupA !== groupB) return "--";
                          const totalRef = toReferenceAmount(
                            watchedUnitPrice.totalAmount,
                            watchedUnitPrice.totalUnit,
                          );
                          const baseRef = toReferenceAmount(
                            watchedUnitPrice.baseAmount,
                            watchedUnitPrice.baseUnit,
                          );
                          if (totalRef <= 0 || baseRef <= 0)
                            return "--";
                          const perBase =
                            (watchedPrice * baseRef) / totalRef;
                          return `${currencySymbol}${perBase.toFixed(2)} / ${watchedUnitPrice.baseAmount} ${watchedUnitPrice.baseUnit}`;
                        })()}
                        <span className="text-muted-foreground">▾</span>
                      </Button>
                    </PopoverTrigger>

                    <PopoverContent align="start" className="w-96">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <div className="text-sm font-medium">
                            {t("admin.productForm.fields.totalAmount")}
                          </div>
                          <div className="flex items-center gap-2">
                            <NumberInput
                              step="0.01"
                              min={0}
                              value={watchedUnitPriceTotalAmount}
                              whenEmpty={0}
                              onValueChange={(next) =>
                                form.setValue(
                                  "pricing.unitPrice.totalAmount",
                                  next ?? 0,
                                  { shouldDirty: true },
                                )
                              }
                            />
                            <Select
                              value={watchedUnitPriceTotalUnit}
                              onValueChange={(val) =>
                                form.setValue(
                                  "pricing.unitPrice.totalUnit",
                                  val as UnitPriceMeasureUnit,
                                  { shouldDirty: true },
                                )
                              }
                            >
                              <SelectTrigger className="w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="item">
                                  item
                                </SelectItem>
                                <SelectItem value="g">g</SelectItem>
                                <SelectItem value="kg">kg</SelectItem>
                                <SelectItem value="lb">lb</SelectItem>
                                <SelectItem value="oz">oz</SelectItem>
                                <SelectItem value="ml">ml</SelectItem>
                                <SelectItem value="l">l</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-sm font-medium">
                            {t("admin.productForm.fields.baseMeasure")}
                          </div>
                          <div className="flex items-center gap-2">
                            <NumberInput
                              step="0.01"
                              min={0}
                              value={watchedUnitPriceBaseAmount}
                              whenEmpty={0}
                              onValueChange={(next) =>
                                form.setValue(
                                  "pricing.unitPrice.baseAmount",
                                  next ?? 0,
                                  { shouldDirty: true },
                                )
                              }
                            />
                            <Select
                              value={watchedUnitPriceBaseUnit}
                              onValueChange={(val) => {
                                form.setValue(
                                  "pricing.unitPrice.baseUnit",
                                  val as UnitPriceMeasureUnit,
                                  { shouldDirty: true },
                                );
                                form.setValue(
                                  "pricing.unitPriceUnit",
                                  val as ProductFormData["pricing"]["unitPriceUnit"],
                                  { shouldDirty: true },
                                );
                              }}
                            >
                              <SelectTrigger className="w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="item">
                                  item
                                </SelectItem>
                                <SelectItem value="g">g</SelectItem>
                                <SelectItem value="kg">kg</SelectItem>
                                <SelectItem value="lb">lb</SelectItem>
                                <SelectItem value="oz">oz</SelectItem>
                                <SelectItem value="ml">ml</SelectItem>
                                <SelectItem value="l">l</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="px-0 text-destructive hover:text-destructive"
                            onClick={() => {
                              form.setValue(
                                "pricing.unitPrice",
                                undefined,
                                { shouldDirty: true },
                              );
                              form.setValue(
                                "pricing.unitPriceUnit",
                                "none",
                                { shouldDirty: true },
                              );
                              setUnitPricePopoverOpen(false);
                            }}
                          >
                            {t("common.clear")}
                          </Button>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                form.setValue(
                                  "pricing.unitPrice",
                                  unitPriceSnapshot?.unitPrice,
                                  { shouldDirty: true },
                                );
                                form.setValue(
                                  "pricing.unitPriceUnit",
                                  unitPriceSnapshot?.unitPriceUnit ||
                                    "none",
                                  { shouldDirty: true },
                                );
                                setUnitPricePopoverOpen(false);
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                            <Button
                              type="button"
                              onClick={() =>
                                setUnitPricePopoverOpen(false)
                              }
                            >
                              {t("common.done")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <FormField
                control={form.control}
                name="pricing.chargeTax"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      {t("admin.productForm.fields.chargeTaxProduct")}
                    </FormLabel>
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
                <FormField
                  control={form.control}
                  name="pricing.cost"
                  render={({ field }) => (
                    <div className="rounded-md border px-3 py-1.5 flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {t("admin.productForm.fields.cost")}
                      </span>
                      <span className="text-muted-foreground">
                        {currencySymbol}
                      </span>
                      <NumberInput
                        step="0.01"
                        min={0}
                        placeholder="--"
                        value={field.value}
                        onValueChange={field.onChange}
                        className="h-5 w-24 border-0 bg-transparent p-0 text-foreground shadow-none focus-visible:ring-0"
                      />
                    </div>
                  )}
                />

                <div className="rounded-md border px-3 py-1.5">
                  <span className="text-muted-foreground">
                    {t("admin.productForm.fields.profit")}
                  </span>{" "}
                  {typeof watchedProfit === "number" ? (
                    <span
                      className={
                        watchedProfit >= 0
                          ? "text-emerald-600"
                          : "text-red-600"
                      }
                    >
                      {watchedProfit >= 0 ? "+" : "-"}
                      {currencySymbol}
                      {Math.abs(watchedProfit).toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </div>

                <div className="rounded-md border px-3 py-1.5">
                  <span className="text-muted-foreground">
                    {t("admin.productForm.fields.margin")}
                  </span>{" "}
                  {typeof watchedMargin === "number" ? (
                    <span
                      className={
                        watchedMargin >= 0
                          ? "text-emerald-600"
                          : "text-red-600"
                      }
                    >
                      {watchedMargin >= 0 ? "+" : "-"}
                      {Math.abs(watchedMargin).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
          </>
        )}

        <Separator />

        <FormField
          control={form.control}
          name="pricing.priceOnRequest"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <FormLabel>
                  {t("admin.productForm.fields.priceOnRequest")}
                </FormLabel>
                <p className="text-xs font-normal text-muted-foreground">
                  {t("admin.productForm.quote.priceOnRequestHelp")}
                </p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {watchedPriceOnRequest ? (
          <FormField
            control={form.control}
            name="pricing.quoteButtonLabel"
            render={({ field }) => (
              <FormItem className="max-w-sm">
                <FormLabel>
                  {t("admin.productForm.fields.quoteButtonLabel")}
                </FormLabel>
                <FormControl>
                  <Input
                    maxLength={60}
                    placeholder={t("product.requestQuote")}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
