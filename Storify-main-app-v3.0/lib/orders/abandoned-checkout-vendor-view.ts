/**
 * A vendor's view of an abandoned checkout: its own lines, and nothing that
 * says who the shopper is.
 *
 * Built as an allowlist — a new object holding only the fields named here —
 * rather than by deleting the private ones from the record, so a field added
 * to the record later stays out of every vendor's list until someone decides
 * it belongs in it. Kept free of models and the database so the rule can be
 * tested on plain objects.
 *
 * What is left out, and why:
 * - the shopper's name, email, phone and addresses: someone who did not buy
 *   is the store's contact, not the seller's (`docs/UPGRADE.md`, 3.0);
 * - other sellers' lines, and the basket's shipping, tax, discounts and total,
 *   which cover every seller's goods and cannot be split by seller;
 * - the recovery link and token, which reopen the whole basket — another
 *   seller's goods and the shopper's address with it — for anyone holding it;
 * - payment events and the recovery-email ladder, which are the store's to
 *   act on.
 */

import {
  latestOfferBy,
  liveOfferOf,
  offerState,
  type OfferState,
  type StoredOffer,
} from "@/lib/orders/abandoned-offer-state";

type Dated = Date | string | null | undefined;

interface SourceLine {
  vendorId?: unknown;
  productId?: unknown;
  variantId?: unknown;
  name?: string | null;
  quantity?: number | null;
  price?: number | null;
  image?: string | null;
}

export interface AbandonedCheckoutSource {
  _id?: unknown;
  userId?: unknown;
  items?: SourceLine[] | null;
  presentmentCurrency?: string | null;
  abandonedAt?: Dated;
  checkoutStartedAt?: Dated;
  updatedAt?: Dated;
  recoveryStatus?: string | null;
  orderId?: unknown;
  /** Read only to decide `offerAvailable`; never copied out. */
  status?: string | null;
  unsubscribedAt?: Dated;
  offers?: StoredOffer[] | null;
}

export interface VendorAbandonedCheckoutLine {
  productId?: string;
  variantId?: string;
  name: string;
  quantity: number;
  price: number;
  image?: string;
}

export interface VendorAbandonedCheckoutRow {
  _id: string;
  /** Whether the shopper was signed in — all a vendor learns about them. */
  customerType: "registered" | "guest";
  items: VendorAbandonedCheckoutLine[];
  itemCount: number;
  /** This vendor's lines only. */
  subtotalPrice: number;
  /**
   * The same figure as `subtotalPrice`: what the Total column prints and
   * sorts on, so a vendor's list can never show or order by the whole basket.
   */
  totalPrice: number;
  presentmentCurrency?: string;
  abandonedAt?: Dated;
  checkoutStartedAt?: Dated;
  updatedAt?: Dated;
  status: "open" | "recovered";
  recoveryStatus: "recovered" | "not_recovered";
  /**
   * The order the shopper came back and placed, when it holds this vendor's
   * consignment — so the row can open it in the vendor's own orders page.
   * Filled in by the list, which can see the orders; absent otherwise.
   */
  order?: { _id: string; orderNumber?: string };
  /**
   * This vendor's own latest offer on the checkout — never another seller's,
   * and never its code (`lib/orders/abandoned-offers.ts`).
   */
  offer?: {
    kind: string;
    type: string;
    value: number;
    validUntil?: Dated;
    status: OfferState;
  };
  /**
   * Whether an offer could go out now: the checkout is open, the shopper has
   * not unsubscribed, and no offer is live on it — whose, the vendor is not
   * told. The send itself checks the rest (an email to send to, consent).
   */
  offerAvailable: boolean;
}

function idString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const id =
    typeof value === "object" && "_id" in value
      ? (value as { _id?: unknown })._id
      : value;
  const text = String(id ?? "");
  return text ? text : undefined;
}

/** Whether a line is this vendor's, by the seller written on it. */
export function isVendorLine(line: SourceLine | null | undefined, vendorId: string) {
  return line?.vendorId != null && String(line.vendorId) === vendorId;
}

/**
 * The vendor's row for one checkout, or null when none of its lines are the
 * vendor's — such a checkout is not in the vendor's list at all.
 */
export function toVendorAbandonedCheckout(
  row: AbandonedCheckoutSource,
  vendorId: string,
): VendorAbandonedCheckoutRow | null {
  const own = (row.items ?? []).filter((line) => isVendorLine(line, vendorId));
  if (own.length === 0) return null;

  const items: VendorAbandonedCheckoutLine[] = own.map((line) => {
    const productId = idString(line.productId);
    const variantId = idString(line.variantId);
    return {
      ...(productId ? { productId } : {}),
      ...(variantId ? { variantId } : {}),
      name: String(line.name ?? ""),
      quantity: Number(line.quantity) || 0,
      price: Number(line.price) || 0,
      ...(line.image ? { image: line.image } : {}),
    };
  });

  const subtotal = items.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const recovered = row.recoveryStatus === "recovered";
  const now = new Date();
  const ownOffer = latestOfferBy(row, vendorId);
  const open = !recovered && (row.status == null || row.status === "open");

  return {
    _id: String(row._id),
    customerType: row.userId ? "registered" : "guest",
    items,
    itemCount: items.reduce((sum, line) => sum + line.quantity, 0),
    subtotalPrice: subtotal,
    totalPrice: subtotal,
    ...(row.presentmentCurrency
      ? { presentmentCurrency: row.presentmentCurrency }
      : {}),
    abandonedAt: row.abandonedAt ?? undefined,
    checkoutStartedAt: row.checkoutStartedAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    status: recovered ? "recovered" : "open",
    recoveryStatus: recovered ? "recovered" : "not_recovered",
    ...(ownOffer
      ? {
          offer: {
            kind: String(ownOffer.kind ?? "manual"),
            type: String(ownOffer.type ?? "percentage"),
            value: Number(ownOffer.value) || 0,
            validUntil: ownOffer.validUntil ?? undefined,
            status: offerState(ownOffer, now),
          },
        }
      : {}),
    offerAvailable: open && !row.unsubscribedAt && !liveOfferOf(row, now),
  };
}

export interface VendorAbandonedProductSummary {
  productId?: string;
  name: string;
  /** How many open checkouts hold it. */
  checkouts: number;
  quantity: number;
  /** Price × quantity across those checkouts. */
  value: number;
}

/**
 * The vendor's products shoppers most often leave behind, over the checkouts
 * still open — what a vendor can act on (a price, a photo, a description).
 * A product is counted once per checkout however many of its lines it holds.
 */
export function topAbandonedProducts(
  rows: readonly VendorAbandonedCheckoutRow[],
  limit = 5,
): VendorAbandonedProductSummary[] {
  const byProduct = new Map<string, VendorAbandonedProductSummary>();

  for (const row of rows) {
    if (row.recoveryStatus === "recovered") continue;
    const seen = new Set<string>();
    for (const line of row.items) {
      const key = line.productId ?? `name:${line.name}`;
      const summary = byProduct.get(key) ?? {
        ...(line.productId ? { productId: line.productId } : {}),
        name: line.name,
        checkouts: 0,
        quantity: 0,
        value: 0,
      };
      if (!seen.has(key)) {
        summary.checkouts += 1;
        seen.add(key);
      }
      summary.quantity += line.quantity;
      summary.value += line.price * line.quantity;
      byProduct.set(key, summary);
    }
  }

  return Array.from(byProduct.values())
    .sort(
      (a, b) =>
        b.checkouts - a.checkouts || b.value - a.value || a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
