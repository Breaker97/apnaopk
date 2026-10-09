import { orderInvoiceRoute } from "@/lib/api-core/shop/orders/invoice";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(orderInvoiceRoute);
