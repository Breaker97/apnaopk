import "server-only";

import { PAYMENT_STATUS } from "@/config/app.config";
import { InventoryLocation, Shipment, User, Vendor } from "@/models";
import { getSettingsLean, type ISettingsData } from "@/models/settings.model";
import { isValidObjectId } from "@/lib/api/validate";
import { quantizeToCurrency } from "@/lib/intl/money";
import { withRecordedLineTax } from "@/lib/orders/line-tax";
import { isSubOrderPaid, resolveVendorPaymentDisplayStatus } from "@/lib/orders/order-payment-status";
import { isPosWalkIn, posWalkInName } from "@/lib/orders/pos-walk-in";
import { storedSaleReceipt } from "@/lib/pos/receipt-payload";
import { trackingPageUrl } from "@/lib/shipping/tracking-urls";
import { combinedRate, taxRegistrationLine, type StoredTaxSettings } from "@/lib/tax/tax-settings";
import type { Address, IOrder, OrderItem, SubOrder } from "@/types";
import type {
  ContextCustomer,
  ContextDelivery,
  ContextItem,
  ContextMoney,
  ContextPos,
  ContextStore,
  ContextTaxMode,
  PrintContext,
} from "./context-types";
import { isParcelStillOut, lineTotal, scopedMoney } from "./money";
import type { TemplateOwner } from "./owner";
import type { TemplateCategory, TemplateLocale } from "./types";

/**
 * `buildOrderContext(order, options)` (docs/INVOICE_TEMPLATE_BUILDER.md
 * §4.7.1): a stored order, projected onto the whitelisted render context for
 * an online invoice, a sticker or a POS reprint.
 *
 * Two halves, so the projection is testable without a database:
 *
 *   - `loadOrderContextSources` reads what the order does not carry: the
 *     store identity (settings, or the vendor when a vendor prints), the
 *     consignments' vendors, the customer and staff users, the POS counter
 *     and the shipments;
 *   - `assembleOrderContext` is pure and does the projection.
 *
 * Only whitelisted values leave here (§4.14): no ids beyond the order
 * number and tracking number, no settings credentials, no carrier tokens,
 * and the staff-only internal note only when the caller asks for it
 * (`internalNote`), which the admin route does only for a template that
 * prints it and the vendor route never does.
 *
 * Templates only read (§4.1): nothing in this file writes.
 */

export interface OrderContextOptions {
  category: TemplateCategory;
  /** Whose paper this is: the platform's, or a vendor printing their consignment. */
  owner: TemplateOwner;
  /**
   * The consignments the context covers. Absent = the whole order. One id =
   * that consignment (a sticker, a vendor's invoice). Several = a partial
   * order (a staff member scoped to some sellers).
   */
  consignmentIds?: ReadonlyArray<string>;
  /** The language of generated labels; the template's, normally. */
  locale?: TemplateLocale;
  /**
   * Put the staff-only `notes` into `order.internalNote` (§4.14). Off unless
   * asked: the admin route asks only when the template prints the note
   * (`designUsesInternalNote`), and the vendor route never asks.
   */
  internalNote?: boolean;
}

/** The parts of a shipment the context reads. */
export interface ShipmentSource {
  _id?: unknown;
  vendorId?: unknown;
  subOrderId?: unknown;
  carrier?: string | null;
  service?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  rate?: { carrierName?: string | null } | null;
  label?: { source?: "internal" | "carrier" | null } | null;
  createdAt?: Date | string | null;
}

export interface VendorSource {
  _id: unknown;
  storeName?: string | null;
  logo?: string | null;
  address?: Partial<Address> | null;
  socialLinks?: { website?: string | null; facebook?: string | null } | null;
  userId?: unknown;
}

export interface OrderContextSources {
  settings: Pick<ISettingsData, "general"> &
    Partial<Pick<ISettingsData, "social">> & {
      shipping?: Pick<NonNullable<ISettingsData["shipping"]>, "courierTrackingLinks"> | null;
      /** Settings → Tax: the store's registration, for `store.taxId`. */
      tax?: StoredTaxSettings;
    };
  /** The consignments' vendors, by id. */
  vendors: ReadonlyArray<VendorSource>;
  /** The printing vendor's owner email, when a vendor prints. */
  vendorOwnerEmail?: string | null;
  /** The customer's account, when the order has one (never the cashier of a walk-in). */
  customer?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  /** The staff member who took the order (the cashier, for a POS sale). */
  staffName?: string | null;
  /** The POS counter's name. */
  counterName?: string | null;
  shipments: ReadonlyArray<ShipmentSource>;
}

type SourceOrder = Omit<IOrder, "customerId"> & {
  customerId?: unknown;
  createdAt?: Date | string;
};

const PICKUP_LABEL: Record<TemplateLocale, string> = { en: "Pickup", bn: "পিকআপ" };

/** The placeholder a counter sale carries instead of a delivery address. */
const POS_DUMMY_ADDRESS = { street: "in-store pos", city: "pos" };

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const isoDate = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// ---------------------------------------------------------------------------
// Consignment selection (shared by the print-context routes)
// ---------------------------------------------------------------------------

/**
 * Which consignments a caller may print, from what they asked for and what
 * they are allowed to see.
 *
 *   - `undefined`: the whole order (nothing asked, no restriction)
 *   - an array: those consignment ids
 *   - `null`: the asked-for consignment does not exist or is outside the
 *     caller's vendors (the routes answer 404)
 *
 * A restriction to vendors (a scoped staff member, the vendor route) keeps
 * only their consignments, and never widens to the whole order unless every
 * consignment is theirs.
 */
export function selectConsignments(
  order: Pick<IOrder, "subOrders">,
  params: { consignmentId?: string | null; vendorIds?: ReadonlyArray<string> | null },
): string[] | null | undefined {
  const subOrders = (order.subOrders || []).filter(Boolean);
  const vendors = (params.vendorIds || []).map(String);
  const allowed = vendors.length > 0 ? subOrders.filter((sub) => vendors.includes(String(sub.vendorId))) : subOrders;

  if (params.consignmentId) {
    const wanted = String(params.consignmentId);
    const found = allowed.find((sub) => String(sub._id) === wanted);
    return found ? [String(found._id)] : null;
  }
  if (vendors.length === 0) return undefined;
  if (allowed.length === 0) return null;
  return allowed.map((sub) => String(sub._id));
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function platformStore(settings: OrderContextSources["settings"]): ContextStore {
  const general = settings.general;
  return {
    name: text(general?.storeName),
    phone: text(general?.storePhone),
    email: text(general?.storeEmail),
    address: text(general?.storeAddress),
    logo: text(general?.logoUrl),
    website: text(general?.storeDomain),
    facebook: text(settings.social?.facebookUrl),
    taxId: text(taxRegistrationLine(settings.tax)),
  };
}

function vendorAddressLine(address: Partial<Address> | null | undefined): string | null {
  if (!address) return null;
  const parts = [address.street, address.apartment, address.city, address.state, address.postalCode, address.country]
    .map(text)
    .filter((part): part is string => Boolean(part) && !isPlaceholder(part!));
  return parts.length > 0 ? parts.join(", ") : null;
}

function vendorStore(vendor: VendorSource, ownerEmail: string | null | undefined): ContextStore {
  return {
    name: text(vendor.storeName),
    phone: text(vendor.address?.phone),
    email: text(ownerEmail),
    address: vendorAddressLine(vendor.address),
    logo: text(vendor.logo),
    website: text(vendor.socialLinks?.website),
    facebook: text(vendor.socialLinks?.facebook),
    // The store collects and files the tax (Settings → Tax Settings → Vendors),
    // so a vendor's own print carries no registration of its own.
    taxId: null,
  };
}

function isPlaceholder(value: string): boolean {
  return value.trim().toLowerCase() === "n/a";
}

function isPosDummyAddress(address: Partial<Address> | null | undefined): boolean {
  if (!address) return false;
  return (
    String(address.street || "").trim().toLowerCase() === POS_DUMMY_ADDRESS.street &&
    String(address.city || "").trim().toLowerCase() === POS_DUMMY_ADDRESS.city
  );
}

/** The delivery address line by line, with placeholders left out. */
export function addressLines(address: Partial<Address> | null | undefined): string[] {
  if (!address || isPosDummyAddress(address)) return [];
  const clean = (value: unknown) => {
    const part = text(value);
    return part && !isPlaceholder(part) ? part : null;
  };
  const city = clean(address.city);
  const state = clean(address.state);
  const postalCode = clean(address.postalCode);
  const cityLine = [[city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" ");
  return [clean(address.street), clean(address.apartment), cityLine || null, clean(address.country)].filter(
    (line): line is string => Boolean(line),
  );
}

function addressName(address: Partial<Address> | null | undefined): string | null {
  if (!address) return null;
  return text(address.fullName) ?? text([address.firstName, address.lastName].filter(Boolean).join(" "));
}

function customerBlock(order: SourceOrder, sources: OrderContextSources): ContextCustomer {
  const walkIn = isPosWalkIn(order);
  const account = walkIn ? null : sources.customer;
  const populated =
    !walkIn && order.customerId && typeof order.customerId === "object"
      ? (order.customerId as { name?: string; email?: string; phone?: string })
      : null;
  const shipping = order.shippingAddress;
  return {
    name: walkIn
      ? (posWalkInName(order) ?? null)
      : (addressName(shipping) ?? text(populated?.name) ?? text(account?.name)),
    phone: text(shipping?.phone) ?? text(order.contactPhone) ?? text(populated?.phone) ?? text(account?.phone),
    email: text(order.guestEmail) ?? (walkIn ? null : (text(populated?.email) ?? text(account?.email))),
    addressLines: addressLines(shipping),
  };
}

const COLOUR_OPTION_NAMES = new Set(["color", "colour", "রং", "রঙ", "কালার"]);
const SIZE_OPTION_NAMES = new Set(["size", "সাইজ", "আকার"]);

function optionValue(item: OrderItem, names: ReadonlySet<string>): string | null {
  const option = (item.variantOptions || []).find((entry) => names.has(String(entry?.name || "").trim().toLowerCase()));
  return text(option?.value);
}

/** "Product - Variant" (admin, vendor, POS lines) prints as "Product" when the variant is known. */
function bareName(item: OrderItem): string {
  const name = String(item.name || "").trim();
  const variant = text(item.variantLabel);
  if (variant && name.toLowerCase().endsWith(` - ${variant.toLowerCase()}`)) {
    return name.slice(0, name.length - variant.length - 3).trim() || name;
  }
  return name;
}

/** One order line as the template sees it (§4.7.2 item columns). */
export function contextItem(
  item: OrderItem,
  currency: string,
  shelf?: { price: number; discountScale: number },
): ContextItem {
  const unitPrice = shelf ? shelf.price : num(item.price);
  const discount = quantizeToCurrency(
    Math.max(0, num(item.lineDiscount?.amount)) * (shelf ? shelf.discountScale : 1),
    currency,
  );
  // A line stored net of tax (marked) shows its "was" price at the shelf price
  // when the line does; an unmarked one keeps the figure it was stored with.
  const compareAt =
    shelf && item.compareAtPriceNet && num(item.compareAtPrice) > 0
      ? quantizeToCurrency(
          num(item.compareAtPrice) *
            (typeof item.taxRate === "number" ? 1 + item.taxRate / 100 : shelf.discountScale),
          currency,
        )
      : num(item.compareAtPrice);
  const weight = num(item.customs?.weight);
  const lineTotalValue = shelf
    ? quantizeToCurrency(Math.max(0, unitPrice * num(item.quantity) - discount), currency)
    : lineTotal(item, currency);
  // The line's tax as recorded: its parts (lib/tax/tax-parts.ts), or its own
  // rate and tax. A shelf price already holds its tax, so its total with tax
  // is the line total.
  const parts = Array.isArray(item.taxParts) && item.taxParts.length > 0 ? item.taxParts : null;
  const lineTax = parts
    ? parts.reduce((sum, part) => sum + num(part.amount), 0)
    : typeof item.tax === "number"
      ? item.tax
      : null;
  // Without a rate of its own, the parts make it: simple parts add up, and a
  // compound part is charged on the price with the parts before it — 10% with
  // a compound 15% is 26.5%, not 25.
  const lineTaxRate =
    typeof item.taxRate === "number"
      ? item.taxRate
      : parts
        ? Math.round(
            combinedRate(parts.map((part) => ({ rate: num(part.rate), compound: part.compound }))) * 100 * 10_000,
          ) / 10_000
        : null;
  return {
    name: bareName(item),
    variant: text(item.variantLabel),
    colour: optionValue(item, COLOUR_OPTION_NAMES),
    size: optionValue(item, SIZE_OPTION_NAMES),
    sku: text(item.variantSku) ?? text(item.sku),
    qty: num(item.quantity),
    unitPrice,
    compareAtPrice: compareAt > unitPrice ? compareAt : null,
    lineDiscount: discount,
    lineTotal: lineTotalValue,
    image: text(item.image),
    weight: weight > 0 ? `${weight} ${item.customs?.weightUnit || "kg"}` : null,
    note: text(item.lineNote),
    taxRate: lineTaxRate,
    tax: lineTax === null ? null : quantizeToCurrency(lineTax, currency),
    totalWithTax:
      lineTax === null ? null : quantizeToCurrency(lineTotalValue + (shelf ? 0 : lineTax), currency),
  };
}

function shipmentFor(
  order: SourceOrder,
  sub: SubOrder | undefined,
  shipments: ReadonlyArray<ShipmentSource>,
): ShipmentSource | undefined {
  const subOrders = (order.subOrders || []).filter(Boolean);
  const candidates = sub
    ? (() => {
        const bySubOrder = shipments.filter((shipment) => String(shipment.subOrderId) === String(sub._id));
        if (bySubOrder.length > 0) return bySubOrder;
        const byVendor = shipments.filter((shipment) => String(shipment.vendorId) === String(sub.vendorId));
        if (byVendor.length > 0) return byVendor;
        return subOrders.length === 1 ? shipments : [];
      })()
    : // The whole of a split order has no single parcel; an order with no
      // consignments at all (legacy) has whatever was shipped for it.
      subOrders.length <= 1
      ? shipments
      : [];
  const time = (shipment: ShipmentSource) => new Date(shipment.createdAt ?? 0).getTime() || 0;
  const latest = [...candidates].sort((a, b) => time(b) - time(a));
  return latest.find((shipment) => text(shipment.trackingNumber)) ?? latest[0];
}

function deliveryBlock(
  order: SourceOrder,
  sub: SubOrder | undefined,
  sources: OrderContextSources,
  locale: TemplateLocale,
): ContextDelivery {
  const subOrders = (order.subOrders || []).filter(Boolean);
  const shipment = shipmentFor(order, sub, sources.shipments);
  const fulfillment = sub?.fulfillment ?? order.fulfillment;
  const method =
    fulfillment?.method === "pickup"
      ? [PICKUP_LABEL[locale], text(fulfillment.pickup?.pickupLocationName)].filter(Boolean).join(": ")
      : (text(sub?.shippingMethod?.name) ?? text(order.shippingMethod?.name));
  const carrier =
    text(sub?.carrier) ?? text(shipment?.carrier) ?? text(shipment?.rate?.carrierName) ?? text(order.carrier);
  const trackingNumber = text(sub?.trackingNumber) ?? text(shipment?.trackingNumber) ?? text(order.trackingNumber);
  const trackingUrl =
    text(shipment?.trackingUrl) ??
    (trackingNumber
      ? (trackingPageUrl({
          carrier: text(shipment?.rate?.carrierName) ?? carrier ?? undefined,
          trackingNumber,
          links: sources.settings.shipping?.courierTrackingLinks,
        }) ?? null)
      : null);
  const vendor = sub ? sources.vendors.find((entry) => String(entry._id) === String(sub.vendorId)) : undefined;
  return {
    method: method || null,
    courier: carrier,
    service: text(shipment?.service),
    trackingNumber,
    trackingUrl,
    seller: subOrders.length > 1 && vendor ? text(vendor.storeName) : null,
    labelSource: shipment?.label?.source ?? null,
  };
}

function posBlock(order: SourceOrder, sources: OrderContextSources, locale: TemplateLocale): ContextPos | null {
  if (order.channel !== "pos") return null;
  const saleTenders = (order.posTenders || []).filter((tender) => tender.kind !== "balance");
  const cashTendered = saleTenders
    .filter((tender) => tender.method === "cash")
    .reduce((sum, tender) => sum + num(tender.tendered ?? tender.amount), 0);
  const change = saleTenders.reduce((sum, tender) => sum + num(tender.change), 0);
  return {
    counter: text(sources.counterName) ?? text(order.fulfillment?.fulfillmentLocationName),
    cashier: text(sources.staffName),
    tenders: saleTenders.map((tender) => ({
      label: methodLabel(tender.method, locale),
      amount: num(tender.amount),
    })),
    cashTendered: cashTendered > 0 ? cashTendered : null,
    change: change > 0 ? change : null,
    taxExemptReason: text(order.taxExemption?.reason),
  };
}

const TENDER_LABELS: Record<TemplateLocale, Record<string, string>> = {
  en: { cash: "Cash", card: "Card", bank: "Bank transfer", store_credit: "Store credit", mobile_money: "Mobile money" },
  bn: { cash: "নগদ", card: "কার্ড", bank: "ব্যাংক ট্রান্সফার", store_credit: "স্টোর ক্রেডিট", mobile_money: "মোবাইল মানি" },
};

function methodLabel(method: string, locale: TemplateLocale): string {
  const key = String(method || "").toLowerCase();
  return TENDER_LABELS[locale][key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The payment status a print states. The whole order: the order's. A
 * consignment: its own, as its seller's order page shows it
 * (`resolveVendorPaymentDisplayStatus`: the consignment's collection state,
 * the order's when refunded, except a COD parcel still out on a refunded order,
 * which prints its own status beside its cash), not the order's roll-up, which reads
 * "Partially paid" on a seller's unpaid parcel. Several consignments: theirs
 * when they agree; otherwise "Partially paid" when any money for them has
 * arrived, else "Pending".
 */
function printedPaymentStatus(order: SourceOrder, chosen: ReadonlyArray<SubOrder>, whole: boolean): string | null {
  if (whole || chosen.length === 0) return text(order.paymentStatus);
  const statuses = chosen.map((sub) =>
    isParcelStillOut(order, sub) ? String(sub.paymentStatus) : resolveVendorPaymentDisplayStatus(order, sub),
  );
  if (statuses.every((status) => status === statuses[0])) return text(statuses[0]);
  const anyArrived = chosen.some(
    (sub, index) => isSubOrderPaid(order, sub) || statuses[index] === PAYMENT_STATUS.PARTIALLY_PAID,
  );
  return anyArrived ? PAYMENT_STATUS.PARTIALLY_PAID : PAYMENT_STATUS.PENDING;
}

/** A POS sale's figures as the receipt printed them (Phase 0 seam). */
function posMoneyAndItems(
  order: SourceOrder,
  currency: string,
  base: ContextMoney,
): { money: ContextMoney; items: ContextItem[] } {
  const receipt = storedSaleReceipt({ ...order, currency });
  const items = (order.items || []).map((item, index) => {
    const printed = receipt.items[index];
    const net = num(item.price);
    const shelf =
      printed && Math.abs(printed.price - net) > 0.0001
        ? { price: printed.price, discountScale: net > 0 ? printed.price / net : 1 }
        : undefined;
    return contextItem(item, currency, shelf);
  });
  const money: ContextMoney = {
    ...base,
    subtotal: quantizeToCurrency(receipt.subtotal, currency),
    discount: quantizeToCurrency(receipt.discount, currency),
    tax: quantizeToCurrency(receipt.tax, currency),
    taxMode: (receipt.taxMode ?? "added") as ContextTaxMode,
    total: quantizeToCurrency(receipt.total, currency),
  };
  return { money, items };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** The pure projection. `buildOrderContext` loads the sources and calls this. */
export function assembleOrderContext(
  order: SourceOrder,
  options: OrderContextOptions,
  sources: OrderContextSources,
): PrintContext {
  const locale: TemplateLocale = options.locale ?? "en";
  const currency = String(order.currency || sources.settings.general?.defaultCurrency || "USD").toUpperCase();
  const subOrders = (order.subOrders || []).filter(Boolean);
  const chosenIds = options.consignmentIds ? options.consignmentIds.map(String) : undefined;
  const chosen = chosenIds ? subOrders.filter((sub) => chosenIds.includes(String(sub._id))) : subOrders;
  const whole = !chosenIds || chosen.length === subOrders.length;
  const single = chosen.length === 1 ? chosen[0] : undefined;

  const lines: OrderItem[] = whole
    ? withRecordedLineTax(order.items || [], subOrders)
    : chosen.flatMap((sub) => (sub.items || []) as OrderItem[]);

  const figures = scopedMoney(order, whole ? undefined : chosenIds, currency);
  const baseMoney: ContextMoney = {
    currency,
    subtotal: figures.subtotal,
    discount: figures.discount,
    delivery: figures.delivery,
    tax: figures.tax,
    // These figures are net, with the tax on top (a tax-inclusive sale is
    // stored net of tax, and a consignment's share comes from
    // `consignmentCharge`), so the tax is "added" whatever the till's prices
    // were. Only a whole POS sale is rebuilt at shelf prices
    // (`posMoneyAndItems`) and says "included".
    taxMode: order.taxExemption ? "exempt" : "added",
    duty: figures.duty,
    total: figures.total,
    paid: figures.paid,
    due: figures.due,
    cod: figures.cod,
    refunded: figures.refunded,
  };
  const { money, items } =
    order.channel === "pos" && whole
      ? posMoneyAndItems(order, currency, baseMoney)
      : { money: baseMoney, items: lines.map((item) => contextItem(item, currency)) };

  const owner = options.owner;
  const printingVendor =
    owner.kind === "vendor" ? sources.vendors.find((vendor) => String(vendor._id) === owner.vendorId) : undefined;
  const store = printingVendor
    ? vendorStore(printingVendor, sources.vendorOwnerEmail)
    : platformStore(sources.settings);

  const posTenderMethods = (order.posTenders || [])
    .filter((tender) => tender.kind !== "balance")
    .map((tender) => tender.method);
  const paymentMethod =
    order.channel === "pos" && posTenderMethods.length > 0 ? posTenderMethods.join("+") : text(order.paymentMethod);

  return {
    category: options.category,
    locale,
    isSample: false,
    store,
    order: {
      number: String(order.orderNumber || order.posLocalReceiptNumber || ""),
      date: isoDate(order.createdAt),
      paymentStatus: printedPaymentStatus(order, chosen, whole),
      paymentMethod,
      customerNote: text(order.customerNote),
      internalNote: options.internalNote ? text(order.notes) : null,
      takenBy: text(sources.staffName),
      channel: order.channel === "pos" ? "pos" : "online",
    },
    customer: customerBlock(order, sources),
    items,
    money,
    delivery: deliveryBlock(order, single ?? (whole && subOrders.length === 1 ? subOrders[0] : undefined), sources, locale),
    pos: posBlock(order, sources, locale),
    page: { number: 1, count: 1 },
    consignment: whole
      ? null
      : single
        ? { id: String(single._id), index: subOrders.indexOf(single) + 1, count: subOrders.length }
        : { id: null, index: 0, count: subOrders.length },
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const VENDOR_FIELDS = "storeName logo address socialLinks userId";
const SHIPMENT_FIELDS = "vendorId subOrderId carrier service trackingNumber trackingUrl rate.carrierName label.source createdAt";

/** Reads everything the projection needs; nothing is written. */
export async function loadOrderContextSources(
  order: SourceOrder,
  options: Pick<OrderContextOptions, "owner">,
): Promise<OrderContextSources> {
  const vendorIds = new Set(
    (order.subOrders || [])
      .filter(Boolean)
      .map((sub) => String(sub.vendorId))
      .filter((id) => isValidObjectId(id)),
  );
  if (options.owner.kind === "vendor" && isValidObjectId(options.owner.vendorId)) {
    vendorIds.add(options.owner.vendorId);
  }

  const walkIn = isPosWalkIn(order);
  const customerId =
    !walkIn && order.customerId && typeof order.customerId !== "object" && isValidObjectId(String(order.customerId))
      ? String(order.customerId)
      : null;
  const staffId = order.staffId && isValidObjectId(String(order.staffId)) ? String(order.staffId) : null;
  const locationId =
    order.channel === "pos" && order.posLocationId && isValidObjectId(String(order.posLocationId))
      ? String(order.posLocationId)
      : null;

  const [settings, vendors, customer, staff, location, shipments] = await Promise.all([
    getSettingsLean(),
    vendorIds.size > 0
      ? Vendor.find({ _id: { $in: [...vendorIds] } })
          .select(VENDOR_FIELDS)
          .lean<VendorSource[]>()
      : Promise.resolve([] as VendorSource[]),
    customerId
      ? User.findById(customerId)
          .select("name email phone")
          .lean<{ name?: string; email?: string; phone?: string } | null>()
      : Promise.resolve(null),
    staffId ? User.findById(staffId).select("name").lean<{ name?: string } | null>() : Promise.resolve(null),
    locationId
      ? InventoryLocation.findById(locationId).select("name").lean<{ name?: string } | null>()
      : Promise.resolve(null),
    Shipment.find({ orderId: order._id }).select(SHIPMENT_FIELDS).lean<ShipmentSource[]>(),
  ]);

  let vendorOwnerEmail: string | null = null;
  const owner = options.owner;
  if (owner.kind === "vendor") {
    const printing = vendors.find((vendor) => String(vendor._id) === owner.vendorId);
    const ownerId = printing?.userId && isValidObjectId(String(printing.userId)) ? String(printing.userId) : null;
    if (ownerId) {
      const ownerUser = await User.findById(ownerId).select("email").lean<{ email?: string } | null>();
      vendorOwnerEmail = ownerUser?.email ?? null;
    }
  }

  return {
    settings: {
      general: settings.general,
      social: settings.social,
      shipping: settings.shipping ? { courierTrackingLinks: settings.shipping.courierTrackingLinks } : null,
      tax: settings.tax as StoredTaxSettings,
    },
    vendors,
    vendorOwnerEmail,
    customer,
    staffName: staff?.name ?? null,
    counterName: location?.name ?? null,
    shipments,
  };
}

/** The render context for a stored order (server). */
export async function buildOrderContext(order: SourceOrder, options: OrderContextOptions): Promise<PrintContext> {
  const sources = await loadOrderContextSources(order, options);
  return assembleOrderContext(order, options, sources);
}
