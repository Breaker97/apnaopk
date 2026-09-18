"use client";

import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { Dispatch, SetStateAction } from "react";
import type { ProductVariant as VariantData } from "@/components/admin/variants-manager";
import type { ProductFormData } from "@/components/admin/product-form/schema";
import { VendorPreorderAccessNotice } from "@/components/vendor/preorder-access-notice";
import type { VendorPreorderAccess } from "@/lib/products/form-options-types";

/**
 * Why this vendor cannot switch a pre-order on, in one line — or null when
 * they can. The variant editor shows it next to its own pre-order switch.
 */
export function preorderLockMessage(
  access?: VendorPreorderAccess | null,
): string | null {
  if (!access || access.allowed) return null;
  return access.blockedBy === "store"
    ? "Pre-orders are switched off for this store."
    : "Your store has to approve you for pre-orders first. Request access in the Pre-orders section.";
}

interface PreorderCardProps {
  form: UseFormReturn<ProductFormData>;
  setVariants: Dispatch<SetStateAction<VariantData[]>>;
  /**
   * Whether any gateway on this store could take the rest of a pre-order
   * later. When false the deferred modes are unsellable, and offering them
   * would let a vendor build a listing whose failure the SHOPPER discovers at
   * checkout, weeks after the mistake was made.
   */
  deferredBalanceSupported?: boolean;
  /**
   * Vendor editor only: whether this vendor may open a pre-order. When not,
   * the switch stays off and the card says why — and offers the request — up
   * front, instead of letting the vendor fill in a pre-order the save will
   * refuse. A pre-order that is already on can still be switched off.
   */
  access?: VendorPreorderAccess | null;
}

export function PreorderCard({
  form,
  setVariants,
  deferredBalanceSupported = true,
  access,
}: PreorderCardProps) {
  const t = useTranslations();
  const locked = Boolean(access && !access.allowed);
  const watchedPreorderEnabled =
    useWatch({ control: form.control, name: "preorder.enabled" }) ?? false;
  const watchedPreorderPaymentMode =
    useWatch({ control: form.control, name: "preorder.paymentMode" }) ||
    "full";

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>
          {t("admin.productForm.sections.preorder")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="preorder.enabled"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <FormLabel className="min-w-0 flex-1 leading-5">
                {t("admin.productForm.fields.enablePreorder")}
              </FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  disabled={locked && !field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    form.clearErrors("shipping.weight");
                    if (!checked) {
                      setVariants((current) =>
                        current.map((variant) => ({
                          ...variant,
                          requiresShipping: false,
                        })),
                      );
                    }
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {access && !access.allowed ? (
          access.blockedBy === "approval" ? (
            <VendorPreorderAccessNotice
              requestedAt={access.requestedAt}
              maxLeadDays={access.maxLeadDays}
              maxDepositPercent={access.maxDepositPercent}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {preorderLockMessage(access)}
            </p>
          )
        ) : null}

        {watchedPreorderEnabled && (
          <>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="preorder.releaseDate"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel className="leading-5">
                      {t("admin.productForm.fields.releaseDate")}
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <div className="min-h-4">
                      <FormMessage className="text-xs leading-4" />
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="preorder.limit"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel className="leading-5">
                      {t("admin.productForm.fields.preorderLimit")}
                    </FormLabel>
                    <FormControl>
                      <NumberInput
                        min={0}
                        step={1}
                        placeholder="0"
                        {...field}
                        whenEmpty={0}
                        normalize={Math.trunc}
                        onValueChange={field.onChange}
                      />
                    </FormControl>
                    <p className="min-h-4 text-xs leading-4 text-muted-foreground">
                      {t("admin.productForm.preorderUnlimitedHint")}
                    </p>
                    <FormMessage className="text-xs leading-4" />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="preorder.paymentMode"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel className="leading-5">
                      Payment collection
                    </FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="full">Full payment</SelectItem>
                        <SelectItem
                          value="deposit"
                          disabled={!deferredBalanceSupported}
                        >
                          Deposit
                        </SelectItem>
                        <SelectItem
                          value="pay_later"
                          disabled={!deferredBalanceSupported}
                        >
                          Pay later
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {!deferredBalanceSupported ? (
                      <p className="text-muted-foreground text-xs leading-4">
                        Only full payment is available: no payment method on
                        this store can charge the rest later. Turn on card
                        payments to offer a deposit.
                      </p>
                    ) : null}
                    <FormMessage className="text-xs leading-4" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="preorder.depositType"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel className="leading-5">
                      Deposit type
                    </FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={watchedPreorderPaymentMode !== "deposit"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed amount</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-xs leading-4" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="preorder.depositValue"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel className="leading-5">
                      Deposit value
                    </FormLabel>
                    <FormControl>
                      <NumberInput
                        min={0}
                        step="0.01"
                        disabled={watchedPreorderPaymentMode !== "deposit"}
                        {...field}
                        whenEmpty={0}
                        onValueChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage className="text-xs leading-4" />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="preorder.supplierEta"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel className="leading-5">
                      Supplier ETA
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs leading-4" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="preorder.batchName"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <FormLabel className="leading-5">
                      Batch name
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Spring drop" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs leading-4" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="preorder.message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("admin.productForm.fields.preorderMessage")}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder={t(
                        "admin.productForm.placeholders.preorderMessage",
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
              name="preorder.reservedQuantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("admin.productForm.fields.preorderReserved")}
                  </FormLabel>
                  <FormControl>
                    <Input type="number" min={0} readOnly {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preorder.preorderOnly"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <FormLabel className="min-w-0 flex-1 leading-5">
                    {t("admin.productForm.fields.preorderOnly")}
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
              name="preorder.autoConvert"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <FormLabel className="min-w-0 flex-1 leading-5">
                    {t("admin.productForm.fields.preorderAutoConvert")}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
