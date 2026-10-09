import { USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { roundMoney } from "@/lib/intl/money";

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

interface POSPaymentValidationInput {
  paymentMethod: unknown;
  enabledMethods?: readonly string[] | null;
  total: number;
  cashTendered?: unknown;
  paymentReference?: unknown;
  paymentNote?: unknown;
}

interface POSPaymentValidationSuccess {
  ok: true;
  method: POSPaymentMethod;
  cashTendered?: number;
  changeDue: number;
  reference?: string;
  note?: string;
  metadata: POSPaymentMetadata;
}

interface POSPaymentValidationFailure {
  ok: false;
  message: string;
}

type POSPaymentValidationResult =
  | POSPaymentValidationSuccess
  | POSPaymentValidationFailure;

interface POSPaymentMetadata extends Record<string, unknown> {
  posPayment: {
    method: POSPaymentMethod;
    cardSubMethod?: string;
    cashTendered?: number;
    changeDue?: number;
    reference?: string;
    note?: string;
  };
}

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

export function validatePOSPaymentInput(
  input: POSPaymentValidationInput,
): POSPaymentValidationResult {
  const method = normalizePOSPaymentMethod(input.paymentMethod);
  if (!method) {
    return { ok: false, message: "Payment method is required" };
  }

  const enabledMethods = getEnabledPOSPaymentMethods(input.enabledMethods);
  const enabledMethod =
    method === "card_touch" || method === "card_stripe" ? "card" : method;
  if (!enabledMethods.includes(enabledMethod)) {
    return { ok: false, message: "Payment method is not enabled for POS" };
  }

  const total = roundMoney(input.total);
  if (!Number.isFinite(total) || total < 0) {
    return { ok: false, message: "Invalid order total" };
  }

  const reference = cleanOptionalText(input.paymentReference, 120);
  const note = cleanOptionalText(input.paymentNote, 500);
  const cashTendered =
    input.cashTendered === undefined || input.cashTendered === null || input.cashTendered === ""
      ? undefined
      : roundMoney(Number(input.cashTendered));

  if (method === "cash") {
    if (cashTendered === undefined || !Number.isFinite(cashTendered)) {
      return { ok: false, message: "Cash tendered amount is required" };
    }
    if (cashTendered < total) {
      return { ok: false, message: "Cash tendered must cover the order total" };
    }
  }

  if (method === "card_stripe" && !reference) {
    return { ok: false, message: "Stripe payment intent is required" };
  }

  const changeDue =
    method === "cash" && cashTendered !== undefined
      ? roundMoney(Math.max(0, cashTendered - total))
      : 0;

  // Map the card sub-methods back to "card" for downstream consumers
  // (e.g. Stripe payment intent creation) while keeping the original
  // value in metadata for audit purposes.
  const normalizedMethod: POSPaymentMethod = (
    method === "card_touch" || method === "card_stripe" ? "card" : method
  ) as POSPaymentMethod;

  return {
    ok: true,
    method: normalizedMethod,
    cashTendered,
    changeDue,
    reference,
    note,
    metadata: buildPOSPaymentMetadata({
      method: normalizedMethod,
      cashTendered,
      changeDue,
      reference,
      note,
      originalMethod: method,
    }),
  };
}

function buildPOSPaymentMetadata(params: {
  method: POSPaymentMethod;
  cashTendered?: number;
  changeDue?: number;
  reference?: string;
  note?: string;
  originalMethod?: string;
}): POSPaymentMetadata {
  return {
    posPayment: {
      method: params.method,
      ...(params.originalMethod &&
      params.originalMethod !== params.method
        ? { cardSubMethod: params.originalMethod }
        : {}),
      ...(params.cashTendered !== undefined
        ? { cashTendered: roundMoney(params.cashTendered) }
        : {}),
      ...(params.changeDue !== undefined
        ? { changeDue: roundMoney(params.changeDue) }
        : {}),
      ...(params.reference ? { reference: params.reference } : {}),
      ...(params.note ? { note: params.note } : {}),
    },
  };
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

function cleanOptionalText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function normalizeId(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && "toString" in value) {
    return value.toString();
  }
  return String(value);
}
