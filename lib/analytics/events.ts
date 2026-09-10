"use client";

import type { CartItem, IOrder, OrderItem } from "@/types";

type AnalyticsConsentState = "granted" | "denied";

interface AnalyticsItem {
  item_id: string;
  item_name: string;
  price?: number;
  quantity?: number;
  item_variant?: string;
  item_category?: string;
  item_brand?: string;
  sku?: string;
}

interface AnalyticsEcommercePayload {
  currency?: string;
  value?: number;
  items?: AnalyticsItem[];
  orderId?: string;
  searchTerm?: string;
  paymentMethod?: string;
}

export interface AnalyticsConfig {
  googleAnalyticsId?: string;
  googleTagManagerId?: string;
  facebookPixelId?: string;
  tiktokPixelId?: string;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    ttq?: {
      track?: (eventName: string, payload?: Record<string, unknown>) => void;
      page?: () => void;
      identify?: (...args: unknown[]) => void;
      instances?: (...args: unknown[]) => unknown;
      load?: (...args: unknown[]) => void;
    };
    storifyAnalyticsConfig?: AnalyticsConfig;
  }
}

const CONSENT_STORAGE_KEY = "storify_analytics_consent";
const PURCHASE_STORAGE_KEY = "storify_tracked_purchase_ids";
const CHECKOUT_SNAPSHOT_KEY = "storify_checkout_analytics_snapshot";
const DIRECT_WARNING_KEY = "storify_analytics_direct_warning_logged";

const MAX_TRACKED_PURCHASE_IDS = 75;

function isBrowser() {
  return typeof window !== "undefined";
}

function storage() {
  if (!isBrowser()) return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanItems(items: AnalyticsItem[] | undefined) {
  return (items || [])
    .map((item) => {
      const quantity = Math.max(1, Number(item.quantity || 1));
      return {
        item_id: String(item.item_id || "").trim(),
        item_name: String(item.item_name || "").trim(),
        price: numberOrUndefined(item.price),
        quantity,
        item_variant: item.item_variant,
        item_category: item.item_category,
        item_brand: item.item_brand,
        sku: item.sku,
      };
    })
    .filter((item) => item.item_id && item.item_name);
}

export function getAnalyticsConsent(): AnalyticsConsentState {
  const stored = storage()?.getItem(CONSENT_STORAGE_KEY);
  return stored === "denied" ? "denied" : "granted";
}

function canTrackAnalytics() {
  return getAnalyticsConsent() === "granted";
}

export function warnAboutDirectAndGtmDuplicates(config?: AnalyticsConfig) {
  if (!isBrowser() || !config?.googleTagManagerId) return;

  const hasDirectIds = Boolean(
    config.googleAnalyticsId || config.facebookPixelId || config.tiktokPixelId,
  );

  if (!hasDirectIds || storage()?.getItem(DIRECT_WARNING_KEY) === "1") return;

  console.warn(
    "Storify analytics: GTM and direct provider IDs are both configured. If GA4, Meta Pixel, or TikTok Pixel are also installed inside GTM, remove the matching direct ID to avoid duplicate events.",
  );
  storage()?.setItem(DIRECT_WARNING_KEY, "1");
}

function analyticsItemFromCartItem(item: CartItem): AnalyticsItem {
  return {
    item_id: String(item.productId),
    item_name: item.name,
    item_variant: item.variantId ? String(item.variantId) : item.variantName,
    price: Number(item.price || 0),
    quantity: Number(item.quantity || 1),
  };
}

export function analyticsItemsFromCart(items: CartItem[]) {
  return cleanItems(items.map(analyticsItemFromCartItem));
}

function analyticsItemFromOrderItem(item: OrderItem): AnalyticsItem {
  return {
    item_id: String(item.productId),
    item_name: item.name,
    item_variant: item.variantId ? String(item.variantId) : undefined,
    sku: item.sku,
    price: Number(item.price || 0),
    quantity: Number(item.quantity || 1),
  };
}

export function analyticsPayloadFromOrder(order: Partial<IOrder>) {
  return normalizePayload({
    orderId: order.orderNumber || (order._id ? String(order._id) : undefined),
    currency: undefined,
    value: Number(order.total || 0),
    paymentMethod: order.paymentMethod,
    items: Array.isArray(order.items)
      ? order.items.map((item) => analyticsItemFromOrderItem(item))
      : [],
  });
}

function normalizePayload(payload: AnalyticsEcommercePayload) {
  const items = cleanItems(payload.items);
  const value =
    numberOrUndefined(payload.value) ??
    items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
      0,
    );

  return {
    ...payload,
    value,
    currency: payload.currency || "USD",
    items,
  };
}

function pushDataLayer(eventName: string, payload?: AnalyticsEcommercePayload) {
  if (!isBrowser()) return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: eventName,
    ecommerce: payload ? ga4Payload(payload) : undefined,
    search_term: payload?.searchTerm,
    payment_method: payload?.paymentMethod,
  });
}

function ga4Payload(payload: AnalyticsEcommercePayload) {
  const normalized = normalizePayload(payload);
  return {
    currency: normalized.currency,
    value: normalized.value,
    transaction_id: normalized.orderId,
    payment_type: normalized.paymentMethod,
    search_term: normalized.searchTerm,
    items: normalized.items,
  };
}

function metaPayload(payload: AnalyticsEcommercePayload) {
  const normalized = normalizePayload(payload);
  return {
    currency: normalized.currency,
    value: normalized.value,
    content_ids: normalized.items.map((item) => item.item_id),
    contents: normalized.items.map((item) => ({
      id: item.item_id,
      quantity: item.quantity || 1,
      item_price: item.price,
    })),
    content_type: "product",
    order_id: normalized.orderId,
    search_string: normalized.searchTerm,
  };
}

function tiktokPayload(payload: AnalyticsEcommercePayload) {
  const normalized = normalizePayload(payload);
  return {
    currency: normalized.currency,
    value: normalized.value,
    contents: normalized.items.map((item) => ({
      content_id: item.item_id,
      content_name: item.item_name,
      quantity: item.quantity || 1,
      price: item.price,
    })),
    content_type: "product",
    order_id: normalized.orderId,
    query: normalized.searchTerm,
  };
}

function track(eventName: string, payload?: AnalyticsEcommercePayload) {
  if (!isBrowser() || !canTrackAnalytics()) return;

  const config = window.storifyAnalyticsConfig || {};
  pushDataLayer(eventName, payload);

  if (config.googleAnalyticsId) {
    window.gtag?.("event", eventName, payload ? ga4Payload(payload) : {});
  }

  const metaEvent = META_EVENTS[eventName];
  if (config.facebookPixelId && metaEvent) {
    window.fbq?.("track", metaEvent, payload ? metaPayload(payload) : {});
  }

  const tiktokEvent = TIKTOK_EVENTS[eventName];
  if (config.tiktokPixelId && tiktokEvent) {
    window.ttq?.track?.(tiktokEvent, payload ? tiktokPayload(payload) : {});
  }
}

const META_EVENTS: Record<string, string> = {
  page_view: "PageView",
  view_item: "ViewContent",
  search: "Search",
  add_to_cart: "AddToCart",
  view_cart: "ViewContent",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
};

const TIKTOK_EVENTS: Record<string, string> = {
  page_view: "PageView",
  view_item: "ViewContent",
  search: "Search",
  add_to_cart: "AddToCart",
  view_cart: "ViewContent",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "CompletePayment",
};

export function trackPageView(url?: string) {
  if (!isBrowser() || !canTrackAnalytics()) return;

  const pageUrl = url || `${window.location.pathname}${window.location.search}`;
  pushDataLayer("page_view", undefined);
  window.gtag?.("event", "page_view", { page_location: window.location.href });

  if (window.storifyAnalyticsConfig?.facebookPixelId) {
    window.fbq?.("track", "PageView");
  }
  if (window.storifyAnalyticsConfig?.tiktokPixelId) {
    window.ttq?.page?.();
    window.ttq?.track?.("PageView", { url: pageUrl });
  }
}

export function trackProductView(payload: AnalyticsEcommercePayload) {
  track("view_item", payload);
}

export function trackSearch(searchTerm: string, payload?: AnalyticsEcommercePayload) {
  const term = searchTerm.trim();
  if (!term) return;
  track("search", { ...payload, searchTerm: term });
}

export function trackAddToCart(payload: AnalyticsEcommercePayload) {
  track("add_to_cart", payload);
}

export function trackCartView(payload: AnalyticsEcommercePayload) {
  track("view_cart", payload);
}

export function trackCheckout(payload: AnalyticsEcommercePayload) {
  track("begin_checkout", payload);
}

export function trackPaymentInfo(payload: AnalyticsEcommercePayload) {
  track("add_payment_info", payload);
}

export function trackPurchase(payload: AnalyticsEcommercePayload) {
  const normalized = normalizePayload(payload);
  const orderId = normalized.orderId?.trim();
  if (!orderId || hasTrackedPurchase(orderId)) return;

  track("purchase", normalized);
  markPurchaseTracked(orderId);
}

export function saveCheckoutAnalyticsSnapshot(payload: AnalyticsEcommercePayload) {
  const snapshot = normalizePayload(payload);
  storage()?.setItem(CHECKOUT_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function readCheckoutAnalyticsSnapshot() {
  const raw = storage()?.getItem(CHECKOUT_SNAPSHOT_KEY);
  if (!raw) return null;

  try {
    return normalizePayload(JSON.parse(raw) as AnalyticsEcommercePayload);
  } catch {
    return null;
  }
}

export function clearCheckoutAnalyticsSnapshot() {
  storage()?.removeItem(CHECKOUT_SNAPSHOT_KEY);
}

function getTrackedPurchaseIds() {
  const raw = storage()?.getItem(PURCHASE_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function hasTrackedPurchase(orderId: string) {
  return getTrackedPurchaseIds().includes(orderId);
}

function markPurchaseTracked(orderId: string) {
  const ids = [orderId, ...getTrackedPurchaseIds().filter((id) => id !== orderId)]
    .slice(0, MAX_TRACKED_PURCHASE_IDS);
  storage()?.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(ids));
}
