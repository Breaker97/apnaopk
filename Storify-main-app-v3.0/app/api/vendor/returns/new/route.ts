import { openReturnDialogHandlers } from "@/lib/returns/open-return-routes";

/**
 * Opening a return for a shopper: GET ?orderId= says what may come back, POST
 * prices a selection without opening anything. See
 * lib/returns/open-return-routes.ts.
 */
const handlers = openReturnDialogHandlers("vendor");

export const GET = handlers.GET;
export const POST = handlers.POST;
