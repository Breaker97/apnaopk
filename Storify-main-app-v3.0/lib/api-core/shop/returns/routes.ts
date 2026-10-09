import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import {
  CreateReturnRequest,
  CreatedReturns,
  RETURN_REFUSALS,
  ReturnOptions,
  ReturnPreview,
  ReturnPreviewRequest,
  ShopperReturn,
  ShopperReturnList,
  ShopperReturnListQuery,
} from "@/contracts/mobile/shop/v1/returns";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { findCustomerOrder } from "@/lib/api-core/shop/orders/detail";
import { toMoney } from "@/lib/api-core/shop/money";
import { nextPageCursor, pageFromCursor } from "@/lib/api-core/shop/page-cursor";
import { productSlugsOf } from "@/lib/api-core/shop/product-slugs";
import { isValidObjectId } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { createReturnRequests } from "@/lib/returns/create-return";
import { getReturnCopy, type ReturnCopy } from "@/lib/returns/return-copy";
import { planReturnRequest } from "@/lib/returns/return-plan";
import {
  REFUND_DESTINATION_METHODS,
  getRefundDestinationRequiredFields,
  refundSettlesOutOfBand,
  validateRefundDestination,
} from "@/lib/returns/refund-settlement";
import { RETURN_REASONS } from "@/lib/returns/returns";
import { ReturnRequest } from "@/models";
import { getSettings } from "@/models/settings.model";
import type { IOrder } from "@/types";
import { productIdsOfReturns, toReturnRefund, toShopperReturn } from "./dto";
import { assertReturnSelection, toReturnError } from "./returnability";

/**
 * The shopper's returns from the app: the options of an order, a priced
 * preview, the submission, and the returns they have. The website's own path
 * (lib/returns: `planReturnRequest`, `createReturnRequests`), so a return
 * opened in the app is priced, checked and notified exactly as one opened on
 * the website.
 */

type ReturnableOrder = Parameters<typeof assertReturnSelection>[0];
type DestinationOrder = Parameters<typeof refundSettlesOutOfBand>[0];

const asReturnable = (order: IOrder) => order as unknown as ReturnableOrder;

function paidWith(order: IOrder): "cod" | "bank_transfer" | "counter" | "other" {
  const source = order as unknown as { channel?: string; paymentMethod?: string };
  if (String(source.channel || "").toLowerCase() === "pos") return "counter";
  const method = String(source.paymentMethod || "").toLowerCase();
  if (method === "cod") return "cod";
  if (method === "bank_transfer") return "bank_transfer";
  return "other";
}

function orderCurrency(order: IOrder, fallback: string): string {
  return String((order as unknown as { currency?: string }).currency || fallback);
}

/** GET /orders/{id}/returns/options */
export const returnOptionsRoute = defineRoute({
  id: "returns.options",
  method: "GET",
  path: "/orders/{id}/returns/options",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: ReturnOptions,
  handler: async ({ params, session, locale }) => {
    const [order, copy] = await Promise.all([
      findCustomerOrder(params.id, session.user.id),
      getReturnCopy(locale),
    ]);
    const required = refundSettlesOutOfBand(order as unknown as DestinationOrder);
    return {
      reasons: RETURN_REASONS.map((code) => ({
        code,
        label: copy.reason(code),
        noteRequired: code === "other",
      })),
      refundDestination: {
        required,
        ...(required ? { message: copy.whyDestination(paidWith(order)) } : {}),
        methods: required
          ? REFUND_DESTINATION_METHODS.map((method) => {
              const needed = new Set<string>(getRefundDestinationRequiredFields(method));
              const keys = method === "cash" ? [] : ["accountName", "accountNumber", "provider"];
              return {
                method,
                label: copy.method(method),
                fields: keys.map((key) => ({ key, ...copy.field(method, key), required: needed.has(key) })),
                ...(method === "cash" ? { note: copy.cashNote() } : {}),
              };
            })
          : [],
      },
    };
  },
});

async function selectionContext(orderId: string, userId: string, locale: string) {
  await connectDB();
  const [order, settings, copy] = await Promise.all([
    findCustomerOrder(orderId, userId),
    getSettings(),
    getReturnCopy(locale),
  ]);
  return { order, settings, copy };
}

const toPlanItems = (lines: Array<{ index: number; quantity: number }>) =>
  lines.map((line) => ({ orderItemIndex: line.index, quantity: line.quantity }));

/** POST /orders/{id}/returns/preview: the refund as the store would pay it. Nothing is written. */
export const returnPreviewRoute = defineRoute({
  id: "returns.preview",
  method: "POST",
  path: "/orders/{id}/returns/preview",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "returns:preview", preset: "lenient" },
  demo: "default",
  reasons: { values: RETURN_REFUSALS },
  input: ReturnPreviewRequest,
  output: ReturnPreview,
  handler: async ({ input, params, session, locale }) => {
    const { order, settings, copy } = await selectionContext(params.id, session.user.id, locale);
    await assertReturnSelection(asReturnable(order), settings, input, copy);
    try {
      const plan = await planReturnRequest({
        order: asReturnable(order),
        items: toPlanItems(input.lines),
        reason: input.reason,
        settings: settings as never,
      });
      return {
        parcels: plan.groups.map((group) => ({
          lines: group.items.map((item) => ({
            index: Number(item.orderItemIndex),
            name: String(item.name || ""),
            quantity: Number(item.quantityRequested || 0),
          })),
          refund: toReturnRefund(group.estimatedRefund, plan.currency),
        })),
        total: toMoney(plan.total, plan.currency),
        storeAtFault: plan.merchantAtFault,
        refundsShipping: plan.refundsShipping,
        refundDestinationRequired: plan.settlesOutOfBand,
      };
    } catch (error) {
      throw toReturnError(error);
    }
  },
});

function refuseDestination(problems: string[]): MobileApiError {
  return new MobileApiError(400, "VALIDATION_ERROR", problems[0] ?? "Say where the refund should go.", {
    reason: "REFUND_DESTINATION_REQUIRED",
    errors: { refundDestination: problems },
  });
}

/**
 * POST /orders/{id}/returns: the website's `createReturnRequests`, opened by
 * the shopper. One return per seller on an order several sellers shipped.
 */
export const createReturnRoute = defineRoute({
  id: "returns.create",
  method: "POST",
  path: "/orders/{id}/returns",
  auth: "user",
  cache: { kind: "private" },
  status: 201,
  rateLimit: { bucket: "returns:create", preset: "moderate" },
  demo: "block-mutations",
  idempotency: "required",
  reasons: { values: RETURN_REFUSALS },
  input: CreateReturnRequest,
  output: CreatedReturns,
  handler: async ({ input, params, session, locale }) => {
    const { order, settings, copy } = await selectionContext(params.id, session.user.id, locale);
    await assertReturnSelection(asReturnable(order), settings, input, copy);
    if (input.reason === "other" && !input.note?.trim()) {
      const message = "Tell us what went wrong, so we can sort the right refund out";
      throw new MobileApiError(400, "VALIDATION_ERROR", message, { reason: "NOTE_REQUIRED", errors: { note: [message] } });
    }
    if (refundSettlesOutOfBand(order as unknown as DestinationOrder)) {
      const problems = validateRefundDestination(input.refundDestination);
      if (problems.length > 0) throw refuseDestination(problems);
    }
    let created;
    try {
      created = await createReturnRequests({
        order: asReturnable(order) as never,
        items: toPlanItems(input.lines),
        reason: input.reason,
        ...(input.note?.trim() ? { customerNote: input.note.trim() } : {}),
        ...(input.refundDestination ? { refundDestination: input.refundDestination } : {}),
        settings,
        userId: session.user.id,
        openedBy: "customer",
      });
    } catch (error) {
      throw toReturnError(error);
    }
    const currency = orderCurrency(order, settings.general?.defaultCurrency || "USD");
    const slugs = await productSlugsOf(productIdsOfReturns(created));
    return {
      returns: created.map((doc) => toShopperReturn(doc as never, { copy, currency, slugs })),
    };
  },
});

async function storeCurrency(): Promise<string> {
  const settings = await getSettings();
  return settings.general?.defaultCurrency || "USD";
}

/** The returns as the contract shows them: their lines' product pages come from one query for all of them. */
async function shopperReturns(docs: unknown[], copy: ReturnCopy, currency: string) {
  const slugs = await productSlugsOf(productIdsOfReturns(docs));
  return docs.map((doc) => toShopperReturn(doc as never, { copy, currency, slugs }));
}

/** GET /me/returns: the shopper's returns, newest first. */
export const myReturnsRoute = defineRoute({
  id: "me.returns.list",
  method: "GET",
  path: "/me/returns",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  input: ShopperReturnListQuery,
  output: ShopperReturnList,
  handler: async ({ input, session, locale }) => {
    const page = pageFromCursor(input.cursor);
    const limit = input.limit ?? LIST_DEFAULT_LIMIT;
    await connectDB();
    const query = { customerId: session.user.id };
    const [rows, total, copy, currency] = await Promise.all([
      ReturnRequest.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ReturnRequest.countDocuments(query),
      getReturnCopy(locale),
      storeCurrency(),
    ]);
    return {
      items: await shopperReturns(rows, copy, currency),
      nextCursor: nextPageCursor(page, Math.max(1, Math.ceil(total / limit))),
    };
  },
});

/** GET /me/returns/{id}: one of the shopper's returns; somebody else's is 404. */
export const myReturnRoute = defineRoute({
  id: "me.returns.detail",
  method: "GET",
  path: "/me/returns/{id}",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: ShopperReturn,
  handler: async ({ params, session, locale }) => {
    if (!isValidObjectId(params.id)) throw new MobileApiError(404, "NOT_FOUND", "Return not found.");
    await connectDB();
    const [doc, copy, currency] = await Promise.all([
      ReturnRequest.findOne({ _id: params.id, customerId: session.user.id }).lean(),
      getReturnCopy(locale),
      storeCurrency(),
    ]);
    if (!doc) throw new MobileApiError(404, "NOT_FOUND", "Return not found.");
    const [shopperReturn] = await shopperReturns([doc], copy, currency);
    return shopperReturn!;
  },
});
