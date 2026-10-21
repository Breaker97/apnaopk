import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { generateOrderInvoicePdf } from "@/lib/orders/order-invoice";
import { loadAccessiblePOSOrder } from "@/lib/pos/pos-order-access";

/**
 * GET /api/pos/orders/[id]/invoice
 * Download or print a PDF invoice for an accessible POS order — see
 * lib/pos/pos-order-access.ts for which.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session, request }) => {
    const order = await loadAccessiblePOSOrder(session.user, params.id);

    const settings = await getSettingsLean();
    // Bill to is the invoice builder's: the customer, the delivery name, or
    // for a walk-in (filed under its cashier) nobody. Naming the populated
    // customer here printed the cashier's name and email on the invoice the
    // terminal opens right after every walk-in sale.
    const pdfBuffer = await generateOrderInvoicePdf(order, settings);
    const disposition =
      request.nextUrl.searchParams.get("disposition") === "inline"
        ? "inline"
        : "attachment";

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="invoice-${order.orderNumber}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  },
);
