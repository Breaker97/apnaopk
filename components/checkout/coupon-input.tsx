"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tag, X, Loader2, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";

interface CartItem {
  productId: string;
  price: number;
  quantity: number;
  categoryId?: string;
}

interface CouponInputProps {
  cartItems: CartItem[];
  subtotal: number;
  shippingCost: number;
  /** Each seller's delivery, when the cart is rated per seller. */
  shippingByVendor?: Record<string, number>;
  onApply: (couponData: {
    code: string;
    discount: number;
    type: string;
    discountTarget?: "subtotal" | "shipping";
    maxDiscount?: number;
    vendorShares?: Record<string, number>;
    shippingVendorId?: string;
  }) => void;
  onRemove: () => void;
  appliedCoupon?: {
    code: string;
    discount: number;
    type?: string;
    discountTarget?: "subtotal" | "shipping";
  } | null;
  className?: string;
}

function getCouponErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;

  const errors = "errors" in payload ? payload.errors : null;
  if (errors && typeof errors === "object") {
    const firstFieldErrors = Object.values(
      errors as Record<string, unknown>,
    )[0];
    if (
      Array.isArray(firstFieldErrors) &&
      typeof firstFieldErrors[0] === "string"
    ) {
      return firstFieldErrors[0];
    }
  }

  const message = "message" in payload ? payload.message : null;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function getThrowableMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function CouponInput({
  cartItems,
  subtotal,
  shippingCost,
  shippingByVendor,
  onApply,
  onRemove,
  appliedCoupon,
  className,
}: CouponInputProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const [code, setCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const appliedToShipping =
    appliedCoupon?.discountTarget === "shipping" ||
    isFreeShippingCouponType(appliedCoupon?.type);

  const handleApply = async () => {
    if (!code.trim()) {
      toast.error(
        t("coupon.enterCode")
      );
      return;
    }

    setIsValidating(true);

    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          cartItems,
          subtotal,
          shippingCost,
          ...(shippingByVendor ? { shippingByVendor } : {}),
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data.success) {
        throw new Error(
          getCouponErrorMessage(
            data,
            t("coupon.invalid"),
          ),
        );
      }

      onApply({
        code: data.data.code,
        discount: data.data.discount,
        type: data.data.type,
        discountTarget: data.data.discountTarget,
        maxDiscount: data.data.maxDiscount,
        vendorShares: data.data.vendorShares,
        shippingVendorId: data.data.shippingVendorId,
      });

      toast.success(
        data.data.discountTarget === "shipping"
          ? t("coupon.freeShippingApplied")
          : t("coupon.applied", {
              defaultMessage: `Coupon applied! You save ${formatPrice(
                data.data.discount,
              )}`,
            }),
      );
      setCode("");
    } catch (error: unknown) {
      toast.error(
        getThrowableMessage(
          error,
          t("coupon.invalid"),
        ),
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemove = () => {
    onRemove();
    setCode("");
    toast.success(t("coupon.removed"));
  };

  if (appliedCoupon) {
    const appliedCouponDetail = appliedToShipping
      ? appliedCoupon.discount > 0
        ? `(${t("common.shipping")}: -${formatPrice(
            appliedCoupon.discount,
          )})`
        : `(${t("common.shipping")})`
      : `(-${formatPrice(appliedCoupon.discount)})`;

    return (
      <div
        className={cn(
          "flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-green-600" />
          <span className="font-medium text-green-700 dark:text-green-400">
            {appliedCoupon.code}
          </span>
          <span className="text-sm text-green-600">
            {appliedCouponDetail}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRemove}
          className="text-green-700 hover:text-green-800 hover:bg-green-100"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("coupon.placeholder")}
            className="pl-10"
            disabled={isValidating}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleApply}
          disabled={isValidating || !code.trim()}
        >
          {isValidating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            t("coupon.apply")
          )}
        </Button>
      </div>
    </div>
  );
}
