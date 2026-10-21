/**
 * The Invoice Template Builder's data model (docs/INVOICE_TEMPLATE_BUILDER.md
 * §4.3): a template is a canvas measured in millimetres with elements on it,
 * each bound to fixed text or to order data. One shape for the stored record,
 * the editor, the renderer and the print path.
 *
 * Client-safe: no model or server import. `schema.ts` validates this shape;
 * `defaultElement` and friends give every element type its starting config.
 */
import type { FieldKey, ItemFieldKey } from "./field-keys";

export const SCHEMA_VERSION = 1 as const;

/** What a template prints: an online order's invoice, a POS receipt, a courier sticker. */
export const TEMPLATE_CATEGORIES = ["online", "pos", "sticker"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** The language a preset's text was created in (D-14). */
export const TEMPLATE_LOCALES = ["en", "bn"] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

// ---------------------------------------------------------------------------
// Limits (D-18)
// ---------------------------------------------------------------------------

export const TEMPLATE_LIMITS = {
  /** Templates one owner may keep in one category. */
  templatesPerCategory: 50,
  elements: 300,
  /** The stored design (canvas, format, elements), as JSON. */
  documentBytes: 256 * 1024,
  /** The POS default carried in the cached POS page (Phase 6). */
  posOfflineBytes: 64 * 1024,
  nameLength: 80,
} as const;

// ---------------------------------------------------------------------------
// Fonts and formats
// ---------------------------------------------------------------------------

/** §5.6 font options; `fonts.ts` (Phase 2) maps each to a stack ending in Noto Sans Bengali. */
export const FONT_KEYS = [
  "clean-sans",
  "bangla-friendly",
  "compact-thermal",
  "elegant-serif",
  "mono-code",
  "system",
  "arial",
  "helvetica",
  "noto-sans-bengali",
] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const AMOUNT_FORMATS = ["symbol", "plain", "fixed2"] as const;
export const DATE_FORMATS = ["d MMM yyyy", "dd/MM/yy", "dd/MM/yyyy", "M/d/yyyy"] as const;
export const DIGIT_SETS = ["latin", "bengali"] as const;

export type TemplateFormat = {
  /** ৳3,150 | 3150 | 3150.00 */
  amount: (typeof AMOUNT_FORMATS)[number];
  /** Printed after every amount, e.g. "/=". */
  amountSuffix?: string;
  date: (typeof DATE_FORMATS)[number];
  digits: (typeof DIGIT_SETS)[number];
};

export const DEFAULT_FORMAT: TemplateFormat = {
  amount: "symbol",
  date: "d MMM yyyy",
  digits: "latin",
};

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export const GRID_SIZES_MM = [1, 2, 5] as const;
export const HEIGHT_MODES = ["fixed", "auto"] as const;

export type TemplateCanvas = {
  /** A §5.10 size key (canvas-sizes.ts) or "custom". */
  preset: string;
  widthMm: number;
  /** For `auto` (rolls), the design height; printing grows from it. */
  heightMm: number;
  heightMode: (typeof HEIGHT_MODES)[number];
  /** Auto only: the page never prints shorter than this. */
  minHeightMm?: number;
  marginMm: { top: number; right: number; bottom: number; left: number };
  gridMm: (typeof GRID_SIZES_MM)[number];
  background: string;
  defaultFont: FontKey;
};

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export const ELEMENT_TYPES = [
  "text",
  "image",
  "barcode",
  "qr",
  "line",
  "box",
  "businessHeader",
  "customerAddress",
  "orderSummary",
  "productTable",
  "productRows",
  "priceSummary",
  "codBadge",
  "deliveryMethod",
  "notes",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/** The repeating blocks: they can flow across pages (§4.5). */
export const FLOWING_TYPES = ["productTable", "productRows"] as const satisfies readonly ElementType[];

/** Which pages an element prints on (§4.5). */
export const SHOW_ON = ["every", "first", "last", "notFirst"] as const;
export type ShowOn = (typeof SHOW_ON)[number];

export const FONT_WEIGHTS = [400, 500, 600, 700] as const;
export const FONT_STYLES = ["normal", "italic"] as const;
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export const BORDER_STYLES = ["none", "solid", "dashed", "dotted"] as const;

export type ElementStyle = {
  fontFamily?: FontKey;
  /** CSS px (1/96 in, physical — D-15). */
  fontSizePx: number;
  fontWeight: (typeof FONT_WEIGHTS)[number];
  fontStyle: (typeof FONT_STYLES)[number];
  textAlign: (typeof TEXT_ALIGNS)[number];
  verticalAlign: (typeof VERTICAL_ALIGNS)[number];
  lineHeight: number;
  /** Shrink the text down to 6 px before wrapping and clipping (§5.6). */
  shrinkToFit: boolean;
  color: string;
  background: string;
  borderWidthPx: number;
  borderStyle: (typeof BORDER_STYLES)[number];
  borderColor: string;
  radiusPx: number;
  paddingMm: number;
  gapMm: number;
};

/** What an element shows: fixed text, or a data field with text around it. */
export type ElementBinding = {
  mode: "fixed" | "field";
  field?: FieldKey;
  text?: string;
  before?: string;
  after?: string;
  /** Printed when the field resolves to nothing; otherwise nothing prints. */
  fallback?: string;
};

/** A partial template format on one element, overriding the template's. */
export type ElementFormat = Partial<TemplateFormat>;

/** Page flow of a repeating block (§4.5). */
export type FlowConfig = {
  enabled: boolean;
  /** Where rows continue on later pages; absent = top margin + the `every` blocks above. */
  continuationTopMm?: number;
  rowsPerPage?: { first?: number; middle?: number; last?: number };
  repeatHeader: boolean;
};

/** A field shown in a block, in order. */
export type BlockField<K extends string> = { key: K; visible: boolean; label?: string };

export const BUSINESS_HEADER_FIELDS = ["logo", "name", "phone", "email", "address", "website", "facebook", "taxId"] as const;
export const CUSTOMER_ADDRESS_FIELDS = ["name", "phone", "email", "address"] as const;
export const ORDER_SUMMARY_FIELDS = [
  "order.number",
  "order.date",
  "order.paymentStatus",
  "order.paymentMethod",
  "order.takenBy",
  "delivery.method",
  "pos.counter",
  "pos.cashier",
] as const satisfies readonly FieldKey[];
export const PRICE_SUMMARY_ROWS = ["subtotal", "discount", "delivery", "tax", "duty", "total", "paid", "due"] as const;
export const DELIVERY_METHOD_FIELDS = ["method", "courier", "service", "trackingNumber", "trackingUrl", "seller"] as const;

export type TextConfig = Record<string, never>;
export type ImageConfig = {
  source: "media" | "storeLogo";
  /** A media-library URL or a same-site path; only for `media`. */
  src?: string;
  fit: "contain" | "cover" | "stretch";
  /** `storeLogo` only: the store's name, in the element's text style, when the store has no logo. */
  nameWhenNoLogo?: boolean;
};
export type BarcodeConfig = {
  source: "orderNumber" | "trackingNumber" | "fixed";
  /** The value for `fixed`. */
  value?: string;
  /** D-12: Code 128 for bound values; EAN-13/UPC-A only for fixed numeric text. */
  format: "code128" | "ean13" | "upca";
  showText: boolean;
  textSizePx: number;
};
export type QrConfig = {
  source: "trackingLink" | "orderTrackingPage" | "storeWebsite" | "fixed";
  /** The URL for `fixed`. */
  url?: string;
  errorCorrection: "L" | "M" | "Q" | "H";
  /** Quiet zone in modules. */
  quietZone: number;
};
export type LineConfig = { orientation: "horizontal" | "vertical" };
export type BoxConfig = Record<string, never>;
export type BusinessHeaderConfig = {
  fields: BlockField<(typeof BUSINESS_HEADER_FIELDS)[number]>[];
  logoPlacement: "left" | "right" | "top" | "none";
};
export type CustomerAddressConfig = {
  /** A heading such as "Bill to"; empty prints none. */
  title: string;
  fields: BlockField<(typeof CUSTOMER_ADDRESS_FIELDS)[number]>[];
  multiline: boolean;
  longAddress: "shrink" | "wrap";
};
export type OrderSummaryConfig = {
  fields: BlockField<(typeof ORDER_SUMMARY_FIELDS)[number]>[];
  labelAlign: "left" | "right";
  valueAlign: "left" | "right";
};
export type ProductColumn = {
  key: ItemFieldKey;
  label?: string;
  widthPct?: number;
  align: "left" | "center" | "right";
};
export type ProductTableConfig = {
  columns: ProductColumn[];
  showHeader: boolean;
  lines: "grid" | "rows" | "none";
  headerFill: string;
  headerColor: string;
  /** Alternate row fill; empty for none. */
  stripeColor: string;
  cells: "wrap" | "oneLine";
};
export type ProductRowsConfig = {
  fields: ItemFieldKey[];
  /** How the quantity reads: "×2" or "2 pcs". */
  quantityFormat: "times" | "pcs";
  /** "+ N more" when rows don't fit and flow is off. */
  showMore: boolean;
};
export type PriceSummaryRow = {
  key: (typeof PRICE_SUMMARY_ROWS)[number];
  label?: string;
  hideWhenZero: boolean;
  /** Printed as a deduction ("−৳50"). */
  asDeduction: boolean;
  bold: boolean;
};
export type PriceSummaryConfig = {
  rows: PriceSummaryRow[];
  labelAlign: "left" | "right";
  valueAlign: "left" | "right";
};
export type CodBadgeConfig = {
  amountSource: "cod" | "due" | "total";
  label: string;
  /** When nothing is left to collect. */
  whenPaid: "showPaid" | "hide";
  paidLabel: string;
};
export type DeliveryMethodConfig = {
  fields: BlockField<(typeof DELIVERY_METHOD_FIELDS)[number]>[];
};
export type NotesConfig = {
  source: "customerNote" | "internalNote" | "fixed";
  /** The text for `fixed`. */
  text?: string;
  title: string;
};

export type ElementConfigMap = {
  text: TextConfig;
  image: ImageConfig;
  barcode: BarcodeConfig;
  qr: QrConfig;
  line: LineConfig;
  box: BoxConfig;
  businessHeader: BusinessHeaderConfig;
  customerAddress: CustomerAddressConfig;
  orderSummary: OrderSummaryConfig;
  productTable: ProductTableConfig;
  productRows: ProductRowsConfig;
  priceSummary: PriceSummaryConfig;
  codBadge: CodBadgeConfig;
  deliveryMethod: DeliveryMethodConfig;
  notes: NotesConfig;
};

type ElementBase<T extends ElementType> = {
  id: string;
  /** Shown in Layers and in Review warnings. */
  name: string;
  type: T;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  zIndex: number;
  showOn: ShowOn;
  locked?: boolean;
  hidden?: boolean;
  binding?: ElementBinding;
  style: ElementStyle;
  format?: ElementFormat;
  config: ElementConfigMap[T];
} & (T extends (typeof FLOWING_TYPES)[number] ? { flow: FlowConfig } : { flow?: never });

export type TemplateElementOf<T extends ElementType> = ElementBase<T>;
export type TemplateElement = { [T in ElementType]: ElementBase<T> }[ElementType];

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** The editable design: what Save writes, Test Print renders and a preset provides. */
export type TemplateDesign = {
  locale: TemplateLocale;
  canvas: TemplateCanvas;
  format: TemplateFormat;
  elements: TemplateElement[];
};

/** A stored template, as the API returns it. */
export type InvoiceTemplate = TemplateDesign & {
  id: string;
  /** null = the platform's own template. */
  vendorId: string | null;
  category: TemplateCategory;
  name: string;
  isDefault: boolean;
  /** The preset it was made from; "Restore preset" goes back to it. */
  presetKey?: string;
  /** Compare-and-set counter: every save names the version it edited. */
  version: number;
  schemaVersion: typeof SCHEMA_VERSION;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_STYLE: ElementStyle = {
  fontSizePx: 12,
  fontWeight: 400,
  fontStyle: "normal",
  textAlign: "left",
  verticalAlign: "top",
  lineHeight: 1.3,
  shrinkToFit: false,
  color: "#111111",
  background: "transparent",
  borderWidthPx: 0,
  borderStyle: "none",
  borderColor: "#111111",
  radiusPx: 0,
  paddingMm: 0,
  gapMm: 1,
};

export const DEFAULT_FLOW: FlowConfig = { enabled: true, repeatHeader: true };

/** §4.5 smart defaults: totals and the COD badge belong on the last page. */
export function defaultShowOn(type: ElementType): ShowOn {
  return type === "priceSummary" || type === "codBadge" ? "last" : "every";
}

const visible = <K extends string>(keys: readonly K[]): BlockField<K>[] =>
  keys.map((key) => ({ key, visible: true }));

/** Every element type's starting config (§5.3, §5.7). */
export function defaultConfig<T extends ElementType>(type: T): ElementConfigMap[T] {
  const configs: { [K in ElementType]: () => ElementConfigMap[K] } = {
    text: () => ({}),
    image: () => ({ source: "storeLogo", fit: "contain" }),
    barcode: () => ({ source: "orderNumber", format: "code128", showText: true, textSizePx: 10 }),
    qr: () => ({ source: "trackingLink", errorCorrection: "M", quietZone: 2 }),
    line: () => ({ orientation: "horizontal" }),
    box: () => ({}),
    businessHeader: () => ({
      fields: [
        ...visible(["logo", "name", "phone", "address"] as const),
        ...(["email", "website", "facebook"] as const).map((key) => ({ key, visible: false })),
      ],
      logoPlacement: "left",
    }),
    customerAddress: () => ({
      title: "",
      fields: [...visible(["name", "phone", "address"] as const), { key: "email", visible: false }],
      multiline: true,
      longAddress: "wrap",
    }),
    orderSummary: () => ({
      fields: visible(["order.number", "order.date"] as const),
      labelAlign: "left",
      valueAlign: "right",
    }),
    productTable: () => ({
      columns: [
        { key: "item.name", widthPct: 44, align: "left" },
        { key: "item.sku", widthPct: 16, align: "left" },
        { key: "item.qty", widthPct: 10, align: "center" },
        { key: "item.unitPrice", widthPct: 15, align: "right" },
        { key: "item.lineTotal", widthPct: 15, align: "right" },
      ],
      showHeader: true,
      lines: "rows",
      headerFill: "#f2f2f2",
      headerColor: "#111111",
      stripeColor: "",
      cells: "wrap",
    }),
    productRows: () => ({ fields: ["item.name", "item.sku", "item.qty"], quantityFormat: "times", showMore: true }),
    priceSummary: () => ({
      rows: (["subtotal", "delivery", "discount", "paid", "due"] as const).map((key) => ({
        key,
        hideWhenZero: key === "discount" || key === "paid",
        asDeduction: key === "discount" || key === "paid",
        bold: key === "due",
      })),
      labelAlign: "left",
      valueAlign: "right",
    }),
    codBadge: () => ({ amountSource: "cod", label: "", whenPaid: "showPaid", paidLabel: "" }),
    deliveryMethod: () => ({ fields: visible(["method", "courier", "trackingNumber"] as const) }),
    notes: () => ({ source: "customerNote", title: "" }),
  };
  return configs[type]() as ElementConfigMap[T];
}

/** The starting size of a new element, in mm. */
export function defaultSize(type: ElementType): { widthMm: number; heightMm: number } {
  switch (type) {
    case "line":
      return { widthMm: 60, heightMm: 0.5 };
    case "barcode":
      return { widthMm: 50, heightMm: 15 };
    case "qr":
      return { widthMm: 20, heightMm: 20 };
    case "image":
      return { widthMm: 25, heightMm: 15 };
    case "productTable":
    case "productRows":
      return { widthMm: 120, heightMm: 60 };
    case "businessHeader":
    case "customerAddress":
    case "priceSummary":
      return { widthMm: 70, heightMm: 30 };
    case "codBadge":
      return { widthMm: 50, heightMm: 15 };
    default:
      return { widthMm: 50, heightMm: 10 };
  }
}

/** A new element of a type with every default filled in, at a position. */
export function defaultElement<T extends ElementType>(
  type: T,
  init: { id: string; name: string; xMm?: number; yMm?: number; zIndex?: number },
): TemplateElementOf<T> {
  const element = {
    id: init.id,
    name: init.name,
    type,
    xMm: init.xMm ?? 0,
    yMm: init.yMm ?? 0,
    ...defaultSize(type),
    rotationDeg: 0,
    zIndex: init.zIndex ?? 0,
    showOn: defaultShowOn(type),
    style: { ...DEFAULT_STYLE, ...(type === "line" ? { borderStyle: "solid" as const, borderWidthPx: 1 } : {}) },
    config: defaultConfig(type),
    ...(type === "text" ? { binding: { mode: "fixed" as const, text: "Text" } } : {}),
    ...((FLOWING_TYPES as readonly string[]).includes(type) ? { flow: { ...DEFAULT_FLOW } } : {}),
  };
  return element as unknown as TemplateElementOf<T>;
}
