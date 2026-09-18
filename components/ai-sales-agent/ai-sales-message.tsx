"use client";

import * as React from "react";
import Link from "next/link";
import { ImagePlus, Loader2, ShoppingBag, Sparkles } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import type {
  AISalesChatAction,
  AISalesChatMessage,
  AISalesOrderStatusCard,
  AISalesProductCard,
} from "@/lib/ai-sales-agent/types";

export function AISalesHeaderIcon({
  avatarUrl,
  faviconUrl,
  primaryColor,
  accentColor,
  agentName,
}: {
  avatarUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  accentColor: string;
  agentName: string;
}) {
  const src = (avatarUrl?.trim() || faviconUrl?.trim() || "").trim();
  const gradient = `linear-gradient(135deg, ${primaryColor}, ${accentColor})`;
  return (
    <div
      className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full text-white shadow-lg ring-4 ring-background"
      style={{ background: gradient }}
    >
      {src ? (
        <AppImage
          src={src}
          alt={agentName}
          width={48}
          height={48}
          className="h-full w-full object-cover"
        />
      ) : (
        <Sparkles className="h-5 w-5" />
      )}
    </div>
  );
}

type AISalesMessageLabels = {
  addedToCart: string;
  orderPayment: string;
  orderTotal: string;
  viewOrder: string;
  priceOnRequest: string;
};

const DEFAULT_LABELS: AISalesMessageLabels = {
  addedToCart: "Added to your cart!",
  orderPayment: "Payment",
  orderTotal: "Total",
  viewOrder: "View order",
  priceOnRequest: "Price on request",
};

function ProductPreviewCard({
  product,
  formatPrice,
  labels,
  flush = false,
}: {
  product: AISalesProductCard;
  formatPrice: (value: number) => string;
  labels: AISalesMessageLabels;
  flush?: boolean;
}) {
  return (
    <Link
      href={product.url}
      className={cn(
        "flex gap-3 p-3 transition-colors",
        flush
          ? "hover:bg-muted/70"
          : "mt-2 rounded-2xl bg-muted/50 hover:bg-muted",
      )}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-background">
        {product.image ? (
          <AppImage
            src={product.image}
            alt={product.name}
            fill
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImagePlus className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-sm font-semibold text-foreground">
          {product.name}
        </div>
        {product.description && (
          <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted-foreground">
            {product.description}
          </p>
        )}
        <div className="mt-1 text-sm font-semibold text-foreground">
          {product.priceOnRequest
            ? labels.priceOnRequest
            : formatPrice(product.price)}
        </div>
      </div>
    </Link>
  );
}

function OrderPreviewCard({
  order,
  formatPrice,
  labels,
}: {
  order: AISalesOrderStatusCard;
  formatPrice: (value: number) => string;
  labels: AISalesMessageLabels;
}) {
  return (
    <div className="mt-2 rounded-2xl bg-muted/50 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">#{order.orderNumber}</span>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs">
          {order.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {labels.orderPayment}: {order.paymentStatus} · {labels.orderTotal}:{" "}
        {formatPrice(order.total)}
      </p>
      {order.url && (
        <Link
          href={order.url}
          className="mt-3 inline-flex h-8 items-center justify-center rounded-full bg-background px-3 text-xs font-semibold"
        >
          <ShoppingBag className="mr-1.5 h-3.5 w-3.5" />
          {labels.viewOrder}
        </Link>
      )}
    </div>
  );
}

function ActionPill({
  action,
  primaryColor,
  onAddToCart,
  addedActions,
  pendingActions,
  fallbackLabel,
  dense = false,
}: {
  action: AISalesChatAction;
  primaryColor: string;
  onAddToCart?: (action: Extract<AISalesChatAction, { type: "add_to_cart" }>) => Promise<void>;
  addedActions: Set<string>;
  pendingActions: Set<string>;
  fallbackLabel?: string;
  dense?: boolean;
}) {
  const spacing = dense ? "mt-0" : "mt-2";

  if (action.type === "checkout") {
    return (
      <Link
        href={action.href}
        className={cn(
          "flex h-10 w-full items-center justify-center rounded-full px-4 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90",
          spacing,
        )}
        style={{ backgroundColor: primaryColor }}
      >
        {action.label || fallbackLabel || "Continue"}
      </Link>
    );
  }

  const key = `${action.productId}-${action.variantId || "default"}`;
  const added = addedActions.has(key);
  const pending = pendingActions.has(key);
  const label = action.label || fallbackLabel || "Add to cart";

  return (
    <button
      type="button"
      disabled={pending || added || !onAddToCart}
      onClick={() => {
        if (!onAddToCart) return;
        void onAddToCart(action);
      }}
      className={cn(
        "flex h-10 w-full items-center justify-center gap-2 rounded-full border-2 bg-background px-4 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-80",
        spacing,
      )}
      style={{ borderColor: primaryColor, color: primaryColor }}
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {pending ? label : added ? "Added to your cart!" : label}
    </button>
  );
}

export function AISalesAssistantAvatar({
  primaryColor,
}: {
  primaryColor: string;
}) {
  return (
    <div
      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
      style={{ backgroundColor: primaryColor }}
    >
      <Sparkles className="h-3.5 w-3.5" />
    </div>
  );
}

export function AISalesMessageBubble({
  message,
  primaryColor,
  formatPrice,
  onAddToCart,
  addedActions,
  pendingActions,
  helperText,
  labels = DEFAULT_LABELS,
  streaming = false,
}: {
  message: AISalesChatMessage;
  primaryColor: string;
  formatPrice: (value: number) => string;
  onAddToCart?: (action: Extract<AISalesChatAction, { type: "add_to_cart" }>) => Promise<void>;
  addedActions: Set<string>;
  pendingActions: Set<string>;
  helperText?: string;
  labels?: AISalesMessageLabels;
  /** The reply is still arriving; a caret shows the text is growing. */
  streaming?: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-sm px-4 py-2.5 text-sm font-medium text-white shadow-sm"
          style={{ backgroundColor: primaryColor }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <AISalesAssistantAvatar primaryColor={primaryColor} />
      <div className="flex w-full max-w-[85%] flex-col">
        {message.content && (
          <div className="w-fit max-w-full whitespace-pre-line rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
            {message.content}
            {streaming && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current align-[-2px]"
              />
            )}
          </div>
        )}
        {helperText && (
          <p className="mt-1 px-1 text-[11px] italic text-muted-foreground">
            {helperText}
          </p>
        )}
        {(() => {
          const productCards = message.productCards || [];
          const actions = message.actions || [];
          const consumed = new Set<number>();

          const findActionFor = (product: AISalesProductCard) => {
            const index = actions.findIndex((action, idx) => {
              if (consumed.has(idx)) return false;
              if (action.type !== "add_to_cart") return false;
              if (action.productId !== product.id) return false;
              if (product.variantId && action.variantId) {
                return action.variantId === product.variantId;
              }
              return true;
            });
            if (index === -1) return undefined;
            consumed.add(index);
            return actions[index] as Extract<AISalesChatAction, { type: "add_to_cart" }>;
          };

          return (
            <>
              {productCards.map((product) => {
                const action = findActionFor(product);
                return (
                  <div
                    key={`${product.id}-${product.variantId || "default"}`}
                    className="mt-2 overflow-hidden rounded-xl bg-muted/50"
                  >
                    <ProductPreviewCard
                      product={product}
                      formatPrice={formatPrice}
                      labels={labels}
                      flush
                    />
                    {action && (
                      <div className="px-3 pb-3">
                        <ActionPill
                          action={action}
                          primaryColor={primaryColor}
                          onAddToCart={onAddToCart}
                          addedActions={addedActions}
                          pendingActions={pendingActions}
                          fallbackLabel={`Add ${product.name} to cart`}
                          dense
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {message.orderCards?.map((order) => (
                <OrderPreviewCard
                  key={order.orderId}
                  order={order}
                  formatPrice={formatPrice}
                  labels={labels}
                />
              ))}
              {actions.map((action, index) => {
                if (consumed.has(index)) return null;
                const fallbackLabel =
                  action.type === "add_to_cart"
                    ? action.label || "Add to cart"
                    : action.label;
                return (
                  <ActionPill
                    key={`${message.id}-action-${index}`}
                    action={action}
                    primaryColor={primaryColor}
                    onAddToCart={onAddToCart}
                    addedActions={addedActions}
                    pendingActions={pendingActions}
                    fallbackLabel={fallbackLabel}
                  />
                );
              })}
            </>
          );
        })()}
      </div>
    </div>
  );
}
