import { orderTrackInvoiceRoute } from "@/lib/api-core/shop/orders/track-invoice";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(orderTrackInvoiceRoute);
