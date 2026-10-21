import { USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";

const POS_PAYMENT_METHODS = [
  "cash",
  "card",
  "card_touch",
  "card_stripe",
  "manual",
  "bank",
] as const;

type POSPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

/**
 * The subset an admin can switch on in Settings → POS. `card_touch` and
 * `card_stripe` are how a card payment is *taken* at the register, not
 * something the merchant enables, so they are not offered.
 */
export const POS_SELECTABLE_PAYMENT_METHODS = [
  "cash",
  "card",
  "manual",
  "bank",
] as const satisfies readonly POSPaymentMethod[];

export type POSSelectablePaymentMethod =
  (typeof POS_SELECTABLE_PAYMENT_METHODS)[number];

interface POSInvoiceAccessUser {
  id?: string | null;
  role?: string | null;
}

interface POSInvoiceAccessOrder {
  channel?: string | null;
  staffId?: string | null;
  items?: Array<{ vendorId?: unknown }>;
  subOrders?: Array<{ vendorId?: unknown }>;
}

function normalizePOSPaymentMethod(
  value: unknown,
): POSPaymentMethod | null {
  const method = String(value || "").trim().toLowerCase();
  return POS_PAYMENT_METHODS.includes(method as POSPaymentMethod)
    ? (method as POSPaymentMethod)
    : null;
}

/**
 * How a tender is named on a receipt the server writes (email, text). The
 * till prints its own, translated; these are the store's transactional
 * language, as every other server-written message is.
 */
export function posPaymentLabel(method: unknown): string {
  switch (String(method || "").trim().toLowerCase()) {
    case "cash":
      return "Cash";
    case "card":
    case "card_touch":
    case "card_stripe":
      return "Card";
    case "bank":
      return "Bank transfer";
    case "store_credit":
      return "Store credit";
    case "manual":
      return "Other payment";
    default:
      return "Payment";
  }
}

export function getEnabledPOSPaymentMethods(
  enabledMethods?: readonly string[] | null,
): POSPaymentMethod[] {
  if (enabledMethods === undefined || enabledMethods === null) {
    return ["cash", "card"];
  }

  const normalized = (enabledMethods || [])
    .map(normalizePOSPaymentMethod)
    .filter((method): method is POSPaymentMethod => Boolean(method));

  return Array.from(new Set(normalized));
}

export function canAccessPOSInvoiceOrder(params: {
  user: POSInvoiceAccessUser;
  order: POSInvoiceAccessOrder | null | undefined;
  vendorId?: unknown;
}) {
  const { user, order } = params;
  if (!user || !order || order.channel !== "pos") return false;

  if (user.role === USER_ROLES.ADMIN || isStaffRole(user.role)) return true;

  if (user.role !== USER_ROLES.VENDOR) return false;
  const vendorId = normalizeId(params.vendorId);
  if (!vendorId) return false;

  return [
    ...(order.items || []).map((item) => item.vendorId),
    ...(order.subOrders || []).map((subOrder) => subOrder.vendorId),
  ].some((id) => normalizeId(id) === vendorId);
}

function normalizeId(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && "toString" in value) {
    return value.toString();
  }
  return String(value);
}
