"use client";

import { useEffect, useState } from "react";
import { Loader2, Package, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  messageProductPrices,
  type MessageProduct,
} from "@/components/chat/chat-message-product";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

interface ProductPickerProps {
  conversationId: string;
  disabled?: boolean;
  onPick: (product: MessageProduct) => void;
  labels: {
    button: string;
    search: string;
    empty: string;
    error: string;
    share: (name: string) => string;
    priceOnRequest: string;
  };
}

/** One answer of the product search, with the search it answers. */
interface SearchResult {
  key: string;
  products: MessageProduct[];
  error?: string;
}

/**
 * The composer's "share a product" button: a popover with a search over the
 * products this conversation may share (the server decides which: the
 * storefront's, and in a seller's conversation only that seller's), newest
 * first. Picking one puts it on the reply, to send as a card.
 */
export function ProductPicker({
  conversationId,
  disabled = false,
  onPick,
  labels,
}: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const term = useDebounce(query.trim(), 300);
  const [result, setResult] = useState<SearchResult | null>(null);
  const key = `${conversationId}\u0000${term}`;
  const loading = open && result?.key !== key;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams(term ? { q: term } : {});
    fetch(`/api/chat/conversations/${conversationId}/products?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || labels.error);
        }
        setResult({ key, products: payload.data.products || [] });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          products: [],
          error: error instanceof Error ? error.message : labels.error,
        });
      });
    return () => controller.abort();
  }, [open, key, term, conversationId, labels.error]);

  const products = result?.key === key ? result.products : [];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 rounded-full"
          disabled={disabled}
          aria-label={labels.button}
          title={labels.button}
        >
          <Package className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
      >
        <div className="relative border-b p-2">
          <Search
            className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className="h-9 rounded-full ps-8"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5" aria-busy={loading}>
          {loading ? (
            <div className="grid h-24 place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : result?.error ? (
            <p className="px-3 py-6 text-center text-sm text-destructive">
              {result.error}
            </p>
          ) : products.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {labels.empty}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {products.map((product) => (
                <li key={product.productId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl p-1.5 text-start hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    aria-label={labels.share(product.name)}
                    onClick={() => {
                      onPick(product);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <ProductThumb product={product} className="size-11" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {product.name}
                      </span>
                      <ProductPrice
                        product={product}
                        priceOnRequest={labels.priceOnRequest}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The product on a reply before it is sent, above the field: its picture,
 * name and price, and a way to take it off.
 */
export function AttachedProduct({
  product,
  onRemove,
  removeLabel,
  priceOnRequest,
}: {
  product: MessageProduct;
  onRemove: () => void;
  removeLabel: string;
  priceOnRequest: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-2xl bg-muted/60 p-2 pe-1.5">
      <ProductThumb product={product} className="size-12" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <ProductPrice product={product} priceOnRequest={priceOnRequest} />
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 rounded-full"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <X />
      </Button>
    </div>
  );
}

function ProductThumb({
  product,
  className,
}: {
  product: MessageProduct;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-xl bg-muted",
        className,
      )}
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <Package className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

function ProductPrice({
  product,
  priceOnRequest,
}: {
  product: MessageProduct;
  priceOnRequest: string;
}) {
  const { price, compareAt } = messageProductPrices(product);
  if (!price) {
    return (
      <span className="block text-xs text-muted-foreground">{priceOnRequest}</span>
    );
  }
  return (
    <span className="flex items-baseline gap-1.5 text-xs">
      <span className="font-semibold tabular-nums">{price}</span>
      {compareAt ? (
        <span className="text-muted-foreground line-through tabular-nums">
          {compareAt}
        </span>
      ) : null}
    </span>
  );
}
