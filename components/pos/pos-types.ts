
export interface POSProduct {
  _id: string;
  name: string;
  price: number;
  comparePrice?: number;
  images: string[];
  sku: string;
  barcode?: string;
  stock: number;
  vendorId: string;
  category: string;
  variants: POSVariant[];
  options?: POSOption[];
  /**
   * Stock-policy inputs. `stock` alone is not enough to decide whether a line
   * can still be sold — digital products and "track quantity: off" both leave
   * it at 0 on purpose. Read them through `lib/products/stock-policy`.
   */
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  /**
   * The product's own tax rate, resolved (its own, else its category's) as a
   * fraction; null or absent for the store's. See lib/tax/tax-rates.ts.
   */
  taxRate?: number | null;
}

export interface POSVariant {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  price: number;
  stock: number;
  image?: string;
  optionValues?: { optionId: string; value: string }[];
}

interface POSOption {
  _id: string;
  name: string;
  values: { _id: string; value: string }[];
}

export interface POSCategory {
  _id: string;
  name: string;
  slug: string;
  image?: string;
}

export interface POSLineDiscount {
  type: "percent" | "amount";
  value: number;
}

export interface POSCartItem {
  id: string;
  productId: string;
  variantId?: string;
  name: string;
  variantName?: string;
  sku: string;
  price: number;
  quantity: number;
  image?: string;
  vendorId: string;
  maxStock: number;
  lineDiscount?: POSLineDiscount;
  lineNote?: string;
  /** The product's own tax rate (fraction), null/absent for the store's. */
  taxRate?: number | null;
}

export interface POSCustomer {
  _id: string;
  /**
   * "account" — a customer User; the sale is filed under them.
   * "guest" — a guest customer record (often phone-only), carried alongside a
   * sale filed under the cashier. Absent on holds saved before guests existed,
   * which were all accounts. See lib/pos/pos-customers.ts.
   */
  kind?: "account" | "guest";
  name: string;
  email?: string;
  phone?: string;
  image?: string;
}

/** How the sale names its customer: by account, or by guest record. */
export function posCustomerPayload(customer: POSCustomer | null | undefined): {
  customerId?: string;
  customerProfileId?: string;
} {
  if (!customer) return {};
  return customer.kind === "guest"
    ? { customerProfileId: customer._id }
    : { customerId: customer._id };
}

// Built into the printed page by lib/pos/receipt-html.ts.
export type { ReceiptPrintPayload } from "@/lib/pos/receipt-html";

export interface POSCompletedOrder {
  _id: string;
  orderNumber: string;
  total: number;
  itemCount?: number;
  cashTendered?: number;
  changeDue: number;
  /** A deposit sale: what is still owed. */
  balanceDue?: number;
  /**
   * The server has the sale. False for a sale queued offline, whose `_id` is
   * its provisional receipt number: nothing can be fetched or sent for it
   * until it syncs.
   */
  synced: boolean;
  /** Where the receipt goes by default: the sale's customer, if any. */
  customerEmail?: string;
  customerPhone?: string;
}

export type CustomerMode = "search" | "create";
