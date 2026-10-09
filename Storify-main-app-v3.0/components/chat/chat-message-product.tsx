"use client";

import { useTranslations } from "next-intl";
import { ChevronRight, Package } from "lucide-react";
import Link from "@/components/language/link";
import { cn } from "@/lib/utils";
import { resolveCurrency } from "@/lib/intl/currencies";
import { formatCurrency } from "@/lib/intl/money";
import type { ConversationMessageDTO } from "@/lib/conversations/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export type MessageProduct = NonNullable<ConversationMessageDTO["product"]>;

function priceOf(amount: number | undefined, currency: string | undefined) {
  if (typeof amount !== "number") return undefined;
  const { code, locale } = resolveCurrency(currency);
  return formatCurrency(amount, code, locale);
}

/**
 * A shared product's price and the price before a reduction (only when it is
 * higher), in the product's own currency. No price is a price on request.
 */
export function messageProductPrices(product: MessageProduct) {
  return {
    price: priceOf(product.price, product.currency),
    compareAt:
      typeof product.compareAtPrice === "number" &&
      typeof product.price === "number" &&
      product.compareAtPrice > product.price
        ? priceOf(product.compareAtPrice, product.currency)
        : undefined,
  };
}

/**
 * A product shared in a message, as it was when sent: its picture, name,
 * variant and price, opening the product's page. The price is the one
 * offered then; none is a price on request.
 */
export function ChatMessageProduct({
  product,
  own = false,
}: {
  product: MessageProduct;
  own?: boolean;
}) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);
  const { price, compareAt } = messageProductPrices(product);

  return (
    <Link
      href={`/products/${product.slug}`}
      aria-label={tr("messageProduct.open", "Open {name}", { name: product.name })}
      className={cn(
        // The apps' card: picture at the start, the words centred against it,
        // a shadow rather than a border (kept in dark mode, where a shadow
        // does not show).
        "flex w-80 max-w-full items-center gap-3 rounded-[20px] border border-transparent bg-card p-2.5 pe-3 text-foreground shadow-md transition-colors hover:bg-muted/60 dark:border-border",
        own ? "self-end" : "self-start",
      )}
    >
      <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-muted">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <Package className="size-5 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-snug">
          {product.name}
        </span>
        {product.variantName ? (
          <span className="block truncate text-xs text-muted-foreground">
            {product.variantName}
          </span>
        ) : null}
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm">
          {price ? (
            <>
              <span className="font-semibold tabular-nums">{price}</span>
              {compareAt ? (
                <span className="text-xs text-muted-foreground line-through tabular-nums">
                  {compareAt}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {tr("messageProduct.priceOnRequest", "Price on request")}
            </span>
          )}
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
        aria-hidden="true"
      />
    </Link>
  );
}
