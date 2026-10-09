import { ReturnListQuery, ReturnList, ReturnCase, ReturnOptionsQuery, ReturnOptions, ReturnPreviewRequest, ReturnPreview, ReturnCreateRequest, ReturnCreateResult, ReturnActionRequest, ReturnActionResult, RefundPreviewRequest, RefundPreview, RefundExecuteRequest, RefundResult, RETURN_REASONS } from "@/contracts/mobile/biz/v1/returns";
import { BizUploadAccess } from "@/contracts/mobile/biz/v1/uploads";
import { defineBizRoute, type BizHandlerContext } from "@/lib/api-core/registry";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { readReturnQueue, readReturnOptions, previewReturnCreation } from "./read";
import { scopedReturn } from "./context";
import { toReturnCase } from "./dto";
import { createBizReturns } from "./create";
import { actOnBizReturn } from "./action";
import { previewBizRefund, executeBizRefund, readBizRefund } from "./refund";
import { readReturnAttachment } from "./evidence";

const readPolicy = { cache: { kind: "private" as const }, rateLimit: { bucket: "biz:returns:read", preset: "lenient" as const } };
const writePolicy = { cache: { kind: "private" as const }, rateLimit: { bucket: "biz:returns:write", preset: "moderate" as const }, demo: "default" as const, idempotency: "required" as const, durable: true as const, reasons: { values: RETURN_REASONS } };
const context = (ctx: BizHandlerContext<unknown, string, "any">) => ({ workspace: ctx.workspace, scope: ctx.scope, actorId: ctx.session.user.id, key: ctx.client.idempotencyKey });

export const returnQueueRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.VIEW_RETURNS, id: "returns.list", method: "GET", path: "/returns", input: ReturnListQuery, output: ReturnList, handler: (ctx) => readReturnQueue(ctx.input, context(ctx)) });
export const returnDetailRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.VIEW_RETURNS, id: "returns.detail", method: "GET", path: "/returns/{id}", output: ReturnCase, entityTag: (value) => value.version, handler: async (ctx) => { const { returned, order } = await scopedReturn(ctx.params.id, context(ctx)); return toReturnCase(returned, order, context(ctx)); } });
export const returnOptionsRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.HANDLE_RETURNS, id: "returns.options", method: "GET", path: "/returns/options", input: ReturnOptionsQuery, output: ReturnOptions, handler: (ctx) => readReturnOptions(ctx.input.orderId, context(ctx)) });
export const returnPreviewRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.HANDLE_RETURNS, id: "returns.preview", method: "POST", path: "/returns/preview", input: ReturnPreviewRequest, output: ReturnPreview, demo: "default", handler: (ctx) => previewReturnCreation(ctx.input, context(ctx)) });
export const returnCreateRoute = defineBizRoute({ auth: "user", ...writePolicy, ...BIZ_ACCESS.HANDLE_RETURNS, id: "returns.create", method: "POST", path: "/returns", status: 201, input: ReturnCreateRequest, output: ReturnCreateResult, handler: (ctx) => createBizReturns(ctx.input, context(ctx)) });
export const returnActionRoute = defineBizRoute({ auth: "user", ...writePolicy, ...BIZ_ACCESS.HANDLE_RETURNS, id: "returns.action", method: "POST", path: "/returns/{id}/actions", input: ReturnActionRequest, output: ReturnActionResult, handler: (ctx) => actOnBizReturn(ctx.input, ctx.params.id, context(ctx)) });
export const refundPreviewRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.ISSUE_REFUNDS, id: "refunds.preview", method: "POST", path: "/refunds/preview", input: RefundPreviewRequest, output: RefundPreview, demo: "default", handler: (ctx) => previewBizRefund(ctx.input, context(ctx)) });
export const refundExecuteRoute = defineBizRoute({ auth: "user", ...writePolicy, ...BIZ_ACCESS.ISSUE_REFUNDS, id: "refunds.execute", method: "POST", path: "/refunds/execute", input: RefundExecuteRequest, output: RefundResult, handler: (ctx) => executeBizRefund(ctx.input, context(ctx)) });
export const refundDetailRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.VIEW_RETURNS, id: "refunds.detail", method: "GET", path: "/refunds/{id}", output: RefundResult, handler: (ctx) => readBizRefund(ctx.params.id, context(ctx)) });
export const returnEvidenceRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.VIEW_RETURNS, id: "returns.evidence", method: "GET", path: "/returns/{id}/evidence/{uploadId}", output: BizUploadAccess, handler: (ctx) => readReturnAttachment(ctx.params.id, ctx.params.uploadId, context(ctx)) });
export const returnLabelRoute = defineBizRoute({ auth: "user", ...readPolicy, ...BIZ_ACCESS.VIEW_RETURNS, id: "returns.label", method: "GET", path: "/returns/{id}/label", output: BizUploadAccess, handler: (ctx) => readReturnAttachment(ctx.params.id, undefined, context(ctx)) });
