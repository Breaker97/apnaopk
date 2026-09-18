"use client";

import { useState } from "react";
import { Loader2, ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { useCart } from "@/hooks/use-cart";
import { type ModernProduct } from "@/lib/products/modern-product";
import {
  getProductPriceRange,
  productRequiresVariantSelection,
} from "@/lib/products/price-display";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { trackAddToCart } from "@/lib/analytics/events";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";

/**
 * "Add All to Cart" for a Look. Adds every piece that can be added without
 * a choice — a product with one variant (or none) — and says how many need a
 * size or colour picked on their own page. Lines go in one after another:
 * the cart API reconciles per call, and a burst of parallel adds would race
 * each other over the same document.
 */
export function AddAllToCartButton({
  products,
  label,
  className,
}: {
  products: ModernProduct[];
  label: string;
  className?: string;
}) {
  const t = useTranslations();
  const { addItem } = useCart();
  const { currency } = useCurrency();
  const [busy, setBusy] = useState(false);

  const addAll = async () => {
    if (busy) return;
    setBusy(true);
    let added = 0;
    let needsChoice = 0;
    let failed = 0;
    try {
      for (const product of products) {
        if (isQuoteOnlyProduct(product)) continue;
        const onlyVariant =
          Array.isArray(product.variants) && product.variants.length === 1
            ? product.variants[0]
            : null;
        if (productRequiresVariantSelection(product) && !onlyVariant) {
          needsChoice += 1;
          continue;
        }
        const price = onlyVariant?.price ?? getProductPriceRange(product).min;
        try {
          await addItem({
            productId: product._id,
            variantId: onlyVariant?._id,
            name: onlyVariant
              ? `${product.name} - ${onlyVariant.name}`
              : product.name,
            price,
            image: product.images[0],
            quantity: 1,
          });
          added += 1;
          trackAddToCart({
            currency: currency.code,
            value: price,
            items: [
              {
                item_id: String(product._id),
                item_name: product.name,
                item_variant: onlyVariant?._id,
                price,
                quantity: 1,
              },
            ],
          });
        } catch {
          failed += 1;
        }
      }
    } finally {
      setBusy(false);
    }

    if (added > 0) {
      toast.success(
        t.has("cart.addedAll")
          ? t("cart.addedAll", { count: added })
          : `Added ${added} items to your bag`,
      );
    }
    if (needsChoice > 0) {
      toast.info(
        t.has("cart.addAllNeedsChoice")
          ? t("cart.addAllNeedsChoice", { count: needsChoice })
          : `${needsChoice} need a size or colour — pick them on the product page`,
      );
    }
    if (added === 0 && needsChoice === 0) {
      toast.error(t("common.error"));
    } else if (failed > 0) {
      toast.error(t("common.error"));
    }
  };

  return (
    <Button
      type="button"
      size="lg"
      onClick={() => void addAll()}
      disabled={busy || products.length === 0}
      className={cn("w-full gap-2", className)}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ShoppingBag className="h-4 w-4" />
      )}
      {label}
    </Button>
  );
}
