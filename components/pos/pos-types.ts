
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
}

export interface POSCustomer {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  image?: string;
}

export interface ReceiptPrintPayload {
  orderNumber: string;
  createdAt: string | Date;
  /**
   * The counter this sale was rung up at.
   *
   * Printed because the receipt is the only record the customer walks out with,
   * and a multi-branch merchant handling a return has to know which shop's
   * stock the units came off. Absent when the register sells from shared stock,
   * where naming a branch would be a guess.
   */
  locationName?: string;
  paymentMethod: string;
  cashTendered?: number;
  paymentReference?: string;
  paymentNote?: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    amount: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  balanceReturned: number;
}

export interface POSCompletedOrder {
  _id: string;
  orderNumber: string;
  total: number;
  itemCount?: number;
  cashTendered?: number;
  changeDue: number;
  paymentReference?: string;
  paymentNote?: string;
}

export type CustomerMode = "search" | "create";
