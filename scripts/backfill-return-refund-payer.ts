import { connectDB } from "@/lib/db";
import { Order } from "@/models/order.model";
import { ReturnRequest } from "@/models/return-request.model";
import { resolveRefundPayer } from "@/lib/returns/refund-settlement";

/**
 * Return refund payer backfill
 * ============================
 *
 * A return now records whose money its refund comes out of. On a
 * cash-on-delivery sale the seller's own van collected the notes at the door,
 * so the store is holding nothing to give back — the ledger has always posted
 * such a refund as the seller's, reversing the commission they owe rather than
 * any cash of the store's.
 *
 * Returns written before that carry nothing, and every screen reads their
 * silence as `platform`: the store is asked to send money it never took. This
 * stamps them with the answer the order itself gives, from the same rule the
 * ledger posts by (`resolveRefundPayer` → `isPlatformSettled`), so an old
 * return and a new one for the same seller behave alike.
 *
 * Writes ONLY `refundPayer`, and only where it is missing. It moves no money,
 * touches no ledger entry and changes no amount — custody is a fact about the
 * order that was settled the day it was placed, so there is nothing here that
 * could have been different at the time.
 *
 * Usage:
 *   tsx --env-file=.env scripts/backfill-return-refund-payer.ts --dry-run
 *   tsx --env-file=.env scripts/backfill-return-refund-payer.ts
 */

const DRY_RUN = process.argv.includes("--dry-run");

const ORDER_PROJECTION =
  "orderNumber paymentMethod channel paymentCustody stripePaymentIntentId subOrders.vendorId subOrders.codCollectedBy subOrders.fulfillment.method";

type ReturnRow = {
  _id: unknown;
  returnNumber?: string;
  orderId: unknown;
  ownerType?: string;
  ownerVendorId?: unknown;
};

async function run() {
  await connectDB();

  const rows = await ReturnRequest.find({
    refundPayer: { $exists: false },
  })
    .select("returnNumber orderId ownerType ownerVendorId")
    .lean<ReturnRow[]>();
  console.log(`${rows.length} return(s) without a recorded payer`);

  let stamped = 0;
  let vendorPaid = 0;
  let skippedNoOrder = 0;

  for (const row of rows) {
    const order = await Order.findById(row.orderId)
      .select(ORDER_PROJECTION)
      .lean<Parameters<typeof resolveRefundPayer>[0]["order"] | null>();
    if (!order) {
      skippedNoOrder += 1;
      continue;
    }

    // The same question the planner asks at creation, and only of a SELLER's
    // goods: the store's own stock is sold through a vendor record of its own,
    // and a cash sale of it is the shopkeeper's own till.
    const payer = resolveRefundPayer({
      order,
      vendorId: row.ownerType === "vendor" ? row.ownerVendorId : undefined,
    });

    if (payer === "vendor") vendorPaid += 1;
    stamped += 1;

    if (DRY_RUN) {
      console.log(
        `  ${row.returnNumber || String(row._id)} → ${payer}${
          payer === "vendor" ? "  (the seller sends this one)" : ""
        }`,
      );
      continue;
    }
    await ReturnRequest.updateOne(
      { _id: row._id, refundPayer: { $exists: false } },
      { $set: { refundPayer: payer } },
    );
  }

  console.log(
    `${DRY_RUN ? "Would stamp" : "Stamped"} ${stamped} return(s); ${vendorPaid} are the seller's to refund. ${skippedNoOrder} had no order left to read.`,
  );
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
