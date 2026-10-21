/**
 * `sampleContext(category, locale)` (docs/INVOICE_TEMPLATE_BUILDER.md
 * §4.7.1): the clearly marked sample data the editor, the preview and Test
 * Print fill a template with. Every field has a value, so a designer sees
 * every element filled; `isSample: true` lets the preview say "SAMPLE DATA —
 * not a real order" and keeps a sample from ever being mistaken for a print.
 *
 * `sampleContext(category, locale, { items })` makes a long order (60 lines,
 * for page-flow previews). Client-safe.
 */
import type { ContextItem, PrintContext } from "./context-types";
import type { TemplateCategory, TemplateLocale } from "./types";

const STORE: Record<TemplateLocale, PrintContext["store"]> = {
  en: {
    name: "Storify",
    phone: "+8801700000000",
    email: "shop@example.com",
    address: "House 12, Road 5, Dhanmondi, Dhaka 1209",
    logo: "/logo.png",
    website: "https://storify.example.com",
    facebook: "https://facebook.com/storify",
    taxId: "Sales tax permit 123-456789",
  },
  bn: {
    name: "স্টোরিফাই",
    phone: "+8801700000000",
    email: "shop@example.com",
    address: "বাড়ি ১২, রোড ৫, ধানমন্ডি, ঢাকা ১২০৯",
    logo: "/logo.png",
    website: "https://storify.example.com",
    facebook: "https://facebook.com/storify",
    taxId: "Sales tax permit 123-456789",
  },
};

const CUSTOMER: Record<TemplateLocale, PrintContext["customer"]> = {
  en: {
    name: "Farhana Akter",
    phone: "+8801712345678",
    email: "farhana@example.com",
    addressLines: ["Flat 4B, Green View", "House 7, Road 11", "Banani, Dhaka 1213", "Bangladesh"],
  },
  bn: {
    name: "ফারহানা আক্তার",
    phone: "+8801712345678",
    email: "farhana@example.com",
    addressLines: ["ফ্ল্যাট ৪বি, গ্রিন ভিউ", "বাড়ি ৭, রোড ১১", "বনানী, ঢাকা ১২১৩", "বাংলাদেশ"],
  },
};

type SampleLine = [name: string, variant: string | null, colour: string | null, size: string | null, sku: string, qty: number, price: number, compareAt: number | null, discount: number];

const LINES: Record<TemplateLocale, SampleLine[]> = {
  en: [
    ["Jamdani saree", "Red / Free", "Red", "Free", "JAM-RED", 1, 4500, 5200, 0],
    ["Cotton T-shirt", "Blue / L", "Blue", "L", "TEE-BLU-L", 2, 500, null, 100],
    ["Ceramic mug", null, null, null, "MUG-WHT", 1, 250, null, 0],
  ],
  bn: [
    ["জামদানি শাড়ি", "লাল / ফ্রি", "লাল", "ফ্রি", "JAM-RED", 1, 4500, 5200, 0],
    ["কটন টি-শার্ট", "নীল / L", "নীল", "L", "TEE-BLU-L", 2, 500, null, 100],
    ["সিরামিক মগ", null, null, null, "MUG-WHT", 1, 250, null, 0],
  ],
};

function sampleItem(line: SampleLine, index: number): ContextItem {
  const [name, variant, colour, size, sku, qty, unitPrice, compareAtPrice, lineDiscount] = line;
  return {
    name,
    variant,
    colour,
    size,
    sku,
    qty,
    unitPrice,
    compareAtPrice,
    lineDiscount,
    lineTotal: unitPrice * qty - lineDiscount,
    image: `/samples/product-${(index % 3) + 1}.png`,
    weight: index % 2 === 0 ? "0.5 kg" : null,
    note: null,
    // The sample order carries no tax online, so its tax columns read 0.
    taxRate: 0,
    tax: 0,
    totalWithTax: unitPrice * qty - lineDiscount,
  };
}

function sampleItems(locale: TemplateLocale, count: number): ContextItem[] {
  const base = LINES[locale];
  return Array.from({ length: count }, (_, index) => {
    const line = base[index % base.length]!;
    const item = sampleItem(line, index);
    return index < base.length ? item : { ...item, name: `${item.name} ${index + 1}`, sku: `${item.sku}-${index + 1}` };
  });
}

function sum(items: ContextItem[]): { gross: number; discount: number; units: number } {
  return items.reduce(
    (acc, item) => ({
      gross: acc.gross + item.unitPrice * item.qty,
      discount: acc.discount + item.lineDiscount,
      units: acc.units + item.qty,
    }),
    { gross: 0, discount: 0, units: 0 },
  );
}

export interface SampleContextOptions {
  /** How many lines the sample order has (default 3; 60 makes three A4 pages). */
  items?: number;
}

export function sampleContext(
  category: TemplateCategory,
  locale: TemplateLocale,
  options: SampleContextOptions = {},
): PrintContext {
  const items = sampleItems(locale, Math.max(1, options.items ?? 3));
  const { gross, discount: lineDiscount } = sum(items);
  const couponDiscount = 150;
  const discount = lineDiscount + couponDiscount;
  const delivery = category === "pos" ? 0 : 80;
  const taxable = gross - discount;
  const tax = category === "pos" ? Math.round(taxable * 0.05) : 0;
  const total = taxable + delivery + tax;
  const pos = category === "pos";
  const cashTendered = Math.ceil(total / 100) * 100;

  return {
    category,
    locale,
    isSample: true,
    store: STORE[locale],
    order: {
      number: pos ? "POS-100042" : "ORD-100042",
      date: "2026-10-11T09:30:00.000Z",
      paymentStatus: pos ? "paid" : "pending",
      paymentMethod: pos ? "cash" : "cod",
      customerNote: locale === "bn" ? "দয়া করে বিকেলে ডেলিভারি দিন" : "Please deliver in the afternoon",
      internalNote: locale === "bn" ? "ভঙ্গুর: সাবধানে প্যাক করুন" : "Fragile: pack with care",
      takenBy: locale === "bn" ? "রাহিম উদ্দিন" : "Rahim Uddin",
      channel: pos ? "pos" : "online",
    },
    customer: CUSTOMER[locale],
    items,
    money: {
      currency: "USD",
      subtotal: gross,
      discount,
      delivery,
      tax,
      taxMode: "added",
      duty: 0,
      total,
      paid: pos ? total : 0,
      due: pos ? 0 : total,
      cod: pos ? 0 : total,
      refunded: 0,
    },
    delivery: pos
      ? { method: null, courier: null, service: null, trackingNumber: null, trackingUrl: null, seller: null, labelSource: null }
      : {
          method: locale === "bn" ? "স্ট্যান্ডার্ড ডেলিভারি" : "Standard delivery",
          courier: "Pathao",
          service: "Express",
          trackingNumber: "PT1234567890",
          trackingUrl: "https://storify.example.com/track-order?number=ORD-100042",
          seller: locale === "bn" ? "স্টোরিফাই" : "Storify",
          labelSource: "internal",
        },
    pos: pos
      ? {
          counter: locale === "bn" ? "ধানমন্ডি কাউন্টার" : "Dhanmondi counter",
          cashier: locale === "bn" ? "রাহিম উদ্দিন" : "Rahim Uddin",
          tenders: [{ label: locale === "bn" ? "নগদ" : "Cash", amount: total }],
          cashTendered,
          change: cashTendered - total,
          taxExemptReason: null,
        }
      : null,
    page: { number: 1, count: 1 },
    consignment: category === "sticker" ? { id: "sample-consignment", index: 1, count: 1 } : null,
  };
}
