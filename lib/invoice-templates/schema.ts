/**
 * The one validation schema for a template (§4.2): the editor checks a draft
 * with it, and every server write goes through it. Strict throughout — a key
 * the model does not know is refused, not dropped — and bounded by D-18.
 *
 * Geometry is rounded to the 0.1 mm a template stores (D-15). What is valid
 * but questionable (an element off the page, a barcode too small to scan, a
 * field this category never fills) is the Review tab's business, not this
 * schema's.
 *
 * Client-safe.
 */
import * as z from "zod";
import { CANVAS_SIZES, CUSTOM_SIZE_LIMITS, isCanvasSizeKey } from "./canvas-sizes";
import { FIELD_KEYS, ITEM_FIELD_KEYS } from "./field-keys";
import {
  AMOUNT_FORMATS,
  BORDER_STYLES,
  BUSINESS_HEADER_FIELDS,
  CUSTOMER_ADDRESS_FIELDS,
  DATE_FORMATS,
  DELIVERY_METHOD_FIELDS,
  DIGIT_SETS,
  ELEMENT_TYPES,
  FONT_KEYS,
  FONT_STYLES,
  FONT_WEIGHTS,
  GRID_SIZES_MM,
  HEIGHT_MODES,
  ORDER_SUMMARY_FIELDS,
  PRICE_SUMMARY_ROWS,
  SHOW_ON,
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIMITS,
  TEMPLATE_LOCALES,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
  type ElementType,
  type TemplateDesign,
} from "./types";
import { roundMm } from "./units";

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A length in mm, stored to 0.1 mm. */
const mm = (min: number, max: number) =>
  z.number().min(min).max(max).transform(roundMm);

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const color = z.string().refine((value) => value === "transparent" || COLOR.test(value), {
  message: "Expected a hex colour or transparent",
});
/** A colour, or "" for none. */
const optionalColor = z.string().refine((value) => value === "" || value === "transparent" || COLOR.test(value), {
  message: "Expected a hex colour, transparent or empty",
});

const text = (max: number) => z.string().max(max);

/**
 * A same-site path ("/uploads/2026/10/logo.png"): one slash, then URL path
 * characters only. A browser reads a backslash as a slash and drops tabs and
 * newlines, so "/\evil.example/p.png" or "/<tab>/evil.example" would load from
 * another host; neither matches. The path must also keep the origin it is
 * resolved against, so nothing the pattern lets through can name a host.
 * The service checks images with this too (§4.14).
 */
const SAME_SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;
const SAME_SITE_BASE = "https://same-site.invalid";

export function isSameSitePath(value: string): boolean {
  if (!SAME_SITE_PATH.test(value)) return false;
  try {
    return new URL(value, SAME_SITE_BASE).origin === SAME_SITE_BASE;
  } catch {
    return false;
  }
}

const HTTP_URL = /^https?:\/\/[^/\s\\]+/i;
// Whitespace other than a plain space, control characters and backslashes.
const UNSAFE_URL_CHARACTER = /[\u0000-\u001f\u007f\\]/;

/** An absolute http(s) address with no character a browser would quietly rewrite. */
export function isHttpUrl(value: string): boolean {
  return HTTP_URL.test(value) && !UNSAFE_URL_CHARACTER.test(value);
}

/**
 * An image or link address: a same-site path or an http(s) URL. Whether an
 * absolute URL is the store's own storage is checked on the server
 * (service.ts), since only it knows the storage origin.
 */
const address = z
  .string()
  .max(1000)
  .refine((value) => value === "" || isSameSitePath(value) || isHttpUrl(value), {
    message: "Expected a same-site path or an http(s) URL",
  });

const blockField = <K extends readonly [string, ...string[]]>(keys: K) =>
  z.strictObject({ key: z.enum(keys), visible: z.boolean(), label: text(80).optional() });

/** A block's fields: each key at most once. */
const blockFields = <K extends readonly [string, ...string[]]>(keys: K) =>
  z
    .array(blockField(keys))
    .max(keys.length)
    .refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, {
      message: "A field is listed twice",
    });

// ---------------------------------------------------------------------------
// Template-wide parts
// ---------------------------------------------------------------------------

export const templateFormatSchema = z.strictObject({
  amount: z.enum(AMOUNT_FORMATS),
  amountSuffix: text(8).optional(),
  date: z.enum(DATE_FORMATS),
  digits: z.enum(DIGIT_SETS),
});

const elementFormatSchema = templateFormatSchema.partial();

export const templateCanvasSchema = z
  .strictObject({
    preset: z.string().max(40),
    widthMm: mm(CUSTOM_SIZE_LIMITS.minWidthMm, CUSTOM_SIZE_LIMITS.maxWidthMm),
    heightMm: mm(CUSTOM_SIZE_LIMITS.minHeightMm, CUSTOM_SIZE_LIMITS.maxHeightMm),
    heightMode: z.enum(HEIGHT_MODES),
    minHeightMm: mm(CUSTOM_SIZE_LIMITS.minHeightMm, CUSTOM_SIZE_LIMITS.maxHeightMm).optional(),
    marginMm: z.strictObject({
      top: mm(0, 100),
      right: mm(0, 100),
      bottom: mm(0, 100),
      left: mm(0, 100),
    }),
    gridMm: z.union(GRID_SIZES_MM.map((size) => z.literal(size)) as [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<5>]),
    background: color,
    defaultFont: z.enum(FONT_KEYS),
  })
  .superRefine((canvas, ctx) => {
    if (canvas.preset !== "custom") {
      if (!isCanvasSizeKey(canvas.preset)) {
        ctx.addIssue({ code: "custom", path: ["preset"], message: "Unknown canvas size" });
        return;
      }
      const size = CANVAS_SIZES[canvas.preset];
      if (canvas.widthMm !== size.widthMm) {
        ctx.addIssue({ code: "custom", path: ["widthMm"], message: `${canvas.preset} is ${size.widthMm} mm wide` });
      }
      if (size.heightMode === "fixed" && canvas.heightMm !== size.heightMm) {
        ctx.addIssue({ code: "custom", path: ["heightMm"], message: `${canvas.preset} is ${size.heightMm} mm tall` });
      }
      if (canvas.heightMode !== size.heightMode) {
        ctx.addIssue({ code: "custom", path: ["heightMode"], message: `${canvas.preset} is ${size.heightMode} height` });
      }
    }
    if (canvas.minHeightMm !== undefined && canvas.heightMode !== "auto") {
      ctx.addIssue({ code: "custom", path: ["minHeightMm"], message: "Only a roll has a minimum height" });
    }
    const { top, right, bottom, left } = canvas.marginMm;
    if (left + right >= canvas.widthMm) {
      ctx.addIssue({ code: "custom", path: ["marginMm"], message: "The side margins leave no room" });
    }
    if (top + bottom >= canvas.heightMm) {
      ctx.addIssue({ code: "custom", path: ["marginMm"], message: "The top and bottom margins leave no room" });
    }
  });

export const elementStyleSchema = z.strictObject({
  fontFamily: z.enum(FONT_KEYS).optional(),
  fontSizePx: z.number().min(4).max(200),
  fontWeight: z.union(FONT_WEIGHTS.map((weight) => z.literal(weight)) as [
    z.ZodLiteral<400>,
    z.ZodLiteral<500>,
    z.ZodLiteral<600>,
    z.ZodLiteral<700>,
  ]),
  fontStyle: z.enum(FONT_STYLES),
  textAlign: z.enum(TEXT_ALIGNS),
  verticalAlign: z.enum(VERTICAL_ALIGNS),
  lineHeight: z.number().min(0.8).max(3),
  shrinkToFit: z.boolean(),
  color,
  background: color,
  borderWidthPx: z.number().min(0).max(20),
  borderStyle: z.enum(BORDER_STYLES),
  borderColor: color,
  radiusPx: z.number().min(0).max(200),
  paddingMm: mm(0, 50),
  gapMm: mm(0, 50),
});

export const elementBindingSchema = z
  .strictObject({
    mode: z.enum(["fixed", "field"]),
    field: z.enum(FIELD_KEYS).optional(),
    text: text(2000).optional(),
    before: text(200).optional(),
    after: text(200).optional(),
    fallback: text(200).optional(),
  })
  .superRefine((binding, ctx) => {
    if (binding.mode === "field" && !binding.field) {
      ctx.addIssue({ code: "custom", path: ["field"], message: "Choose a data field" });
    }
  });

const flowSchema = z.strictObject({
  enabled: z.boolean(),
  continuationTopMm: mm(0, 1000).optional(),
  rowsPerPage: z
    .strictObject({
      first: z.number().int().min(1).max(500).optional(),
      middle: z.number().int().min(1).max(500).optional(),
      last: z.number().int().min(1).max(500).optional(),
    })
    .optional(),
  repeatHeader: z.boolean(),
});

// ---------------------------------------------------------------------------
// Per-type configs (§5.7)
// ---------------------------------------------------------------------------

const align = z.enum(["left", "center", "right"]);
const sideAlign = z.enum(["left", "right"]);

const CONFIG_SCHEMAS = {
  text: z.strictObject({}),
  image: z.strictObject({
    source: z.enum(["media", "storeLogo"]),
    src: address.optional(),
    fit: z.enum(["contain", "cover", "stretch"]),
    nameWhenNoLogo: z.boolean().optional(),
  }),
  barcode: z
    .strictObject({
      source: z.enum(["orderNumber", "trackingNumber", "fixed"]),
      value: text(80).optional(),
      format: z.enum(["code128", "ean13", "upca"]),
      showText: z.boolean(),
      textSizePx: z.number().min(4).max(48),
    })
    .superRefine((config, ctx) => {
      // D-12: a bound value (an order or tracking number) is Code 128.
      if (config.format !== "code128" && config.source !== "fixed") {
        ctx.addIssue({ code: "custom", path: ["format"], message: "EAN-13 and UPC-A are for fixed numbers only" });
      }
    }),
  qr: z
    .strictObject({
      source: z.enum(["trackingLink", "orderTrackingPage", "storeWebsite", "fixed"]),
      url: address.optional(),
      errorCorrection: z.enum(["L", "M", "Q", "H"]),
      quietZone: z.number().int().min(0).max(10),
    })
    .superRefine((config, ctx) => {
      // A phone scanning the paper has no site to resolve a path against, so a
      // fixed address is http(s) — the editor's rule (code-checks.ts). The
      // address of another source is never printed and stays as it was.
      if (config.source === "fixed" && config.url && !isHttpUrl(config.url)) {
        ctx.addIssue({ code: "custom", path: ["url"], message: "A QR code's fixed address must be an http(s) URL" });
      }
    }),
  line: z.strictObject({ orientation: z.enum(["horizontal", "vertical"]) }),
  box: z.strictObject({}),
  businessHeader: z.strictObject({
    fields: blockFields(BUSINESS_HEADER_FIELDS),
    logoPlacement: z.enum(["left", "right", "top", "none"]),
  }),
  customerAddress: z.strictObject({
    title: text(80),
    fields: blockFields(CUSTOMER_ADDRESS_FIELDS),
    multiline: z.boolean(),
    longAddress: z.enum(["shrink", "wrap"]),
  }),
  orderSummary: z.strictObject({
    fields: blockFields(ORDER_SUMMARY_FIELDS),
    labelAlign: sideAlign,
    valueAlign: sideAlign,
  }),
  productTable: z
    .strictObject({
      columns: z
        .array(
          z.strictObject({
            key: z.enum(ITEM_FIELD_KEYS),
            label: text(60).optional(),
            widthPct: z.number().min(1).max(100).optional(),
            align,
          }),
        )
        .min(1)
        .max(ITEM_FIELD_KEYS.length),
      showHeader: z.boolean(),
      lines: z.enum(["grid", "rows", "none"]),
      headerFill: optionalColor,
      headerColor: color,
      stripeColor: optionalColor,
      cells: z.enum(["wrap", "oneLine"]),
    })
    .superRefine((config, ctx) => {
      const keys = config.columns.map((column) => column.key);
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({ code: "custom", path: ["columns"], message: "A column is listed twice" });
      }
      const width = config.columns.reduce((sum, column) => sum + (column.widthPct ?? 0), 0);
      if (width > 100.5) {
        ctx.addIssue({ code: "custom", path: ["columns"], message: "The column widths add up to more than 100%" });
      }
    }),
  productRows: z.strictObject({
    fields: z
      .array(z.enum(ITEM_FIELD_KEYS))
      .min(1)
      .max(ITEM_FIELD_KEYS.length)
      .refine((fields) => new Set(fields).size === fields.length, { message: "A field is listed twice" }),
    quantityFormat: z.enum(["times", "pcs"]),
    showMore: z.boolean(),
  }),
  priceSummary: z.strictObject({
    rows: z
      .array(
        z.strictObject({
          key: z.enum(PRICE_SUMMARY_ROWS),
          label: text(60).optional(),
          hideWhenZero: z.boolean(),
          asDeduction: z.boolean(),
          bold: z.boolean(),
        }),
      )
      .min(1)
      .max(PRICE_SUMMARY_ROWS.length)
      .refine((rows) => new Set(rows.map((row) => row.key)).size === rows.length, {
        message: "A row is listed twice",
      }),
    labelAlign: sideAlign,
    valueAlign: sideAlign,
  }),
  codBadge: z.strictObject({
    amountSource: z.enum(["cod", "due", "total"]),
    label: text(60),
    whenPaid: z.enum(["showPaid", "hide"]),
    paidLabel: text(60),
  }),
  deliveryMethod: z.strictObject({ fields: blockFields(DELIVERY_METHOD_FIELDS) }),
  notes: z.strictObject({
    source: z.enum(["customerNote", "internalNote", "fixed"]),
    text: text(2000).optional(),
    title: text(80),
  }),
} satisfies Record<ElementType, z.ZodType>;

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** Wide enough for anything on a 500 × 1000 mm page and well past it. */
const POSITION_MM = 2000;

const elementBase = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Element ids are 1–40 letters, digits, - or _"),
  name: z.string().trim().min(1).max(80),
  xMm: mm(-POSITION_MM, POSITION_MM),
  yMm: mm(-POSITION_MM, POSITION_MM),
  widthMm: mm(0.1, POSITION_MM),
  heightMm: mm(0.1, POSITION_MM),
  rotationDeg: z.number().min(-360).max(360),
  zIndex: z.number().int().min(-10_000).max(10_000),
  showOn: z.enum(SHOW_ON),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  binding: elementBindingSchema.optional(),
  style: elementStyleSchema,
  format: elementFormatSchema.optional(),
};

const elementOf = <T extends ElementType>(type: T) =>
  z.strictObject({
    ...elementBase,
    type: z.literal(type),
    config: CONFIG_SCHEMAS[type],
    ...(type === "productTable" || type === "productRows" ? { flow: flowSchema } : {}),
  });

export const templateElementSchema = z.discriminatedUnion(
  "type",
  ELEMENT_TYPES.map((type) => elementOf(type)) as unknown as [
    ReturnType<typeof elementOf<"text">>,
    ...ReturnType<typeof elementOf<ElementType>>[],
  ],
);

// ---------------------------------------------------------------------------
// The design and the API inputs
// ---------------------------------------------------------------------------

/** The JSON size the stored design takes, in bytes (D-18). */
export function designBytes(design: unknown): number {
  return new TextEncoder().encode(JSON.stringify(design ?? null)).length;
}

export const templateDesignSchema = z
  .strictObject({
    locale: z.enum(TEMPLATE_LOCALES),
    canvas: templateCanvasSchema,
    format: templateFormatSchema,
    elements: z.array(templateElementSchema).max(TEMPLATE_LIMITS.elements),
  })
  .superRefine((design, ctx) => {
    const seen = new Set<string>();
    design.elements.forEach((element, index) => {
      if (seen.has(element.id)) {
        ctx.addIssue({ code: "custom", path: ["elements", index, "id"], message: "Element ids must be unique" });
      }
      seen.add(element.id);
    });
    if (designBytes(design) > TEMPLATE_LIMITS.documentBytes) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: `A template can be at most ${TEMPLATE_LIMITS.documentBytes / 1024} KB`,
      });
    }
  });

export const templateNameSchema = z.string().trim().min(1, "Name the template").max(TEMPLATE_LIMITS.nameLength);

/**
 * POST /api/admin/invoice-templates: blank, from a preset (its design built
 * on the server), or a whole design — "Save as…", or the first save of a
 * draft, which names the preset it was opened from so it can be restored.
 */
export const createTemplateInputSchema = z.strictObject({
  category: z.enum(TEMPLATE_CATEGORIES),
  name: templateNameSchema,
  locale: z.enum(TEMPLATE_LOCALES).optional(),
  presetKey: z.string().max(40).optional(),
  design: templateDesignSchema.optional(),
});

/**
 * PATCH /api/admin/invoice-templates/[id]: a rename, a new design, or both,
 * naming the version it edited. The category is fixed after the first save,
 * so it is not accepted here.
 */
export const updateTemplateInputSchema = z
  .strictObject({
    version: z.number().int().min(1),
    name: templateNameSchema.optional(),
    design: templateDesignSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.design !== undefined, {
    message: "Nothing to save",
  });

export type CreateTemplateInput = z.infer<typeof createTemplateInputSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateInputSchema>;

/** A design checked and normalized, or the first problem in words. */
export function parseTemplateDesign(
  input: unknown,
): { ok: true; design: TemplateDesign } | { ok: false; error: string; path: string } {
  const result = templateDesignSchema.safeParse(input);
  if (result.success) return { ok: true, design: result.data as TemplateDesign };
  const issue = result.error.issues[0]!;
  return { ok: false, error: issue.message, path: issue.path.join(".") };
}
