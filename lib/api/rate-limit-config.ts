import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import type { RateLimitPreset } from "@/lib/rate-limit";
import { isPlainObject } from "@/lib/utils";

type RateLimitPresetSetting = "default" | RateLimitPreset;

type RateLimitSettings = {
  enabled: boolean;
  ipPreset: RateLimitPresetSetting;
  adminPreset: RateLimitPresetSetting;
  vendorPreset: RateLimitPresetSetting;
  checkoutPreset: RateLimitPresetSetting;
  cartPreset: RateLimitPresetSetting;
  couponPreset: RateLimitPresetSetting;
  authPreset: RateLimitPresetSetting;
};

const DEFAULTS: RateLimitSettings = {
  enabled: true,
  ipPreset: "default",
  adminPreset: "default",
  vendorPreset: "default",
  checkoutPreset: "default",
  cartPreset: "default",
  couponPreset: "default",
  authPreset: "default",
};

let cached: RateLimitSettings = DEFAULTS;
let initialized = false;
let lastRefreshAtMs = 0;
let refreshing = false;
const REFRESH_TTL_MS = 60_000;

function isPresetSetting(value: unknown): value is RateLimitPresetSetting {
  return (
    value === "default" ||
    value === "lenient" ||
    value === "moderate" ||
    value === "strict"
  );
}

export function setRateLimitSettingsFromSecurity(security: unknown) {
  if (!isPlainObject(security)) return;
  const rl = security.rateLimiting;
  if (!isPlainObject(rl)) return;

  const next: RateLimitSettings = { ...DEFAULTS };

  if (typeof rl.enabled === "boolean") next.enabled = rl.enabled;

  if (isPresetSetting(rl.ipPreset)) next.ipPreset = rl.ipPreset;
  if (isPresetSetting(rl.adminPreset)) next.adminPreset = rl.adminPreset;
  if (isPresetSetting(rl.vendorPreset)) next.vendorPreset = rl.vendorPreset;
  if (isPresetSetting(rl.checkoutPreset)) next.checkoutPreset = rl.checkoutPreset;
  if (isPresetSetting(rl.cartPreset)) next.cartPreset = rl.cartPreset;
  if (isPresetSetting(rl.couponPreset)) next.couponPreset = rl.couponPreset;
  if (isPresetSetting(rl.authPreset)) next.authPreset = rl.authPreset;

  cached = next;
  initialized = true;
  lastRefreshAtMs = Date.now();
}

async function refreshFromDB() {
  try {
    await connectDB();
    const settings = await getSettings();
    setRateLimitSettingsFromSecurity(settings.security);
  } catch {
    cached = DEFAULTS;
    lastRefreshAtMs = Date.now();
  }
}

function maybeRefresh() {
  const now = Date.now();
  if (refreshing) return;
  if (now - lastRefreshAtMs < REFRESH_TTL_MS) return;
  refreshing = true;
  void refreshFromDB().finally(() => {
    refreshing = false;
  });
}

export function resolveRateLimitPresetForIdentifier(
  identifier: string,
  fallbackPreset: RateLimitPreset,
): RateLimitPreset | null {
  maybeRefresh();
  if (!cached.enabled) return null;

  if (identifier.startsWith("ip:")) {
    return cached.ipPreset === "default" ? fallbackPreset : cached.ipPreset;
  }

  const parts = identifier.split(":");
  const action = parts.length >= 3 ? parts.slice(2).join(":") : "";

  const pick = (setting: RateLimitPresetSetting) =>
    setting === "default" ? fallbackPreset : setting;

  if (action.startsWith("admin:")) return pick(cached.adminPreset);
  if (action.startsWith("vendor:")) return pick(cached.vendorPreset);
  if (action.startsWith("payments:") || action.startsWith("checkout:"))
    return pick(cached.checkoutPreset);
  if (action.startsWith("cart:")) return pick(cached.cartPreset);
  if (action.startsWith("coupons:")) return pick(cached.couponPreset);
  if (action.startsWith("auth:") || action.startsWith("login:"))
    return pick(cached.authPreset);

  return fallbackPreset;
}

async function init() {
  if (initialized) return;
  initialized = true;
  await refreshFromDB();
}

void init();
