import mongoose from "mongoose";

/**
 * Money the books put in the wrong cash account.
 * =============================================
 *
 * Two posting rules answered "which account" without looking at the fact that
 * decides it. Both are fixed, so new money lands correctly — but the entries
 * already written do not move. The ledger is append-only, and a posting key
 * does not carry the account, so replaying an old document collides with what
 * it posted and leaves it exactly as it is. That is the design working: the
 * accounting answer to a balance in the wrong account is another entry, not an
 * edit.
 *
 * This works out what that entry should say. It writes NOTHING.
 *
 * ── The till, holding POS card and bank sales ─────────────────────────────
 *
 * `cashAccountFor` used to answer "the drawer" for every POS order the moment
 * it saw `channel: "pos"`, before it looked at how the cashier actually took
 * the money. A store taking card at the register had every card sale booked
 * into `cash_on_hand`: "Cash in hand" on the Finance overview grew by money
 * sitting with an acquirer, and the gateway balance came up short by exactly
 * that. Bank transfers taken at the counter went the same way.
 *
 * ── The gateway, holding commission collected by hand ─────────────────────
 *
 * `platformPaymentPostings` debited `cash_gateway` for every platform payment
 * whatever carried it — and `manual` is a real provider: an admin recording
 * that a vendor handed over cash, or sent a transfer, for the commission they
 * owed. No gateway was ever involved, so the gateway balance grew by money
 * nothing had paid into it and the bank came up short. The same mistake as
 * above, on a different rail.
 *
 * ── Using it ──────────────────────────────────────────────────────────────
 *
 * Run it, then post what it prints from Finance → Overview → Post adjustment.
 * Worth doing promptly: a refund issued TODAY against one of these follows the
 * CORRECTED rule, so until the adjustment is posted the sale and its refund
 * disagree, and the refund widens the gap instead of closing it.
 *
 * Usage:
 *   node --env-file=.env scripts/report-cash-account-mispostings.mjs
 *   node --env-file=.env scripts/report-cash-account-mispostings.mjs --json
 */

const AS_JSON = process.argv.includes("--json");

/** How a register's takings should have been booked — see `cashAccountFor`. */
const POS_SHOULD_HAVE_BEEN = {
  card: "cash_gateway",
  bank: "cash_bank",
};

const TILL = "cash_on_hand";
const GATEWAY = "cash_gateway";
const BANK = "cash_bank";

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Net movement on `account`, for the ledger entries of the documents a lookup
 * selects. Signed the way the account's own balance is: a debit puts money in.
 */
function nettedAgainst(account, sourceKind, orderPipeline, from, groupKey) {
  return [
    {
      $match: {
        "source.kind": sourceKind,
        $or: [{ debit: account }, { credit: account }],
      },
    },
    {
      $lookup: {
        from,
        localField: "source.id",
        foreignField: "_id",
        pipeline: orderPipeline,
        as: "doc",
      },
    },
    { $unwind: "$doc" },
    {
      $group: {
        _id: { currency: "$currency", bucket: groupKey },
        held: {
          $sum: {
            $cond: [
              { $eq: ["$debit", account] },
              "$amount",
              { $multiply: ["$amount", -1] },
            ],
          },
        },
        entries: { $sum: 1 },
        docs: { $addToSet: "$source.id" },
      },
    },
    {
      $project: {
        _id: 0,
        currency: "$_id.currency",
        bucket: "$_id.bucket",
        held: 1,
        entries: 1,
        docs: { $size: "$docs" },
      },
    },
    { $sort: { currency: 1, bucket: 1 } },
  ];
}

async function posInTheTill(db) {
  /*
   * Read from the LEDGER side and look the order up, rather than listing every
   * POS order first: what matters is the money actually posted, and an order
   * whose entries never made it to the books has nothing to correct.
   */
  const rows = await db
    .collection("ledgerentries")
    .aggregate(
      nettedAgainst(
        TILL,
        "order",
        [
          {
            $match: {
              channel: "pos",
              paymentMethod: { $in: Object.keys(POS_SHOULD_HAVE_BEEN) },
            },
          },
          { $project: { paymentMethod: 1 } },
        ],
        "orders",
        "$doc.paymentMethod",
      ),
      { allowDiskUse: true },
    )
    .toArray();

  return rows.map((row) => ({
    what: `POS ${row.bucket} sale(s)`,
    currency: row.currency,
    debit: POS_SHOULD_HAVE_BEEN[row.bucket],
    credit: TILL,
    amount: money(row.held),
    documents: row.docs,
    entries: row.entries,
  }));
}

async function manualInTheGateway(db) {
  const rows = await db
    .collection("ledgerentries")
    .aggregate(
      nettedAgainst(
        GATEWAY,
        "platform_payment",
        [
          { $match: { provider: "manual" } },
          { $project: { kind: 1 } },
        ],
        "platformpayments",
        "$doc.kind",
      ),
      { allowDiskUse: true },
    )
    .toArray();

  return rows.map((row) => ({
    what: `hand-collected ${row.bucket || "platform"} payment(s)`,
    currency: row.currency,
    debit: BANK,
    credit: GATEWAY,
    amount: money(row.held),
    documents: row.docs,
    entries: row.entries,
  }));
}

/**
 * Balances recorded offline before the account was asked for.
 *
 * Only ever flagged, never totalled: the rule now reads
 * `preorderBalancePaidFrom`, and a balance recorded before that field existed
 * says only that it arrived "offline". Where it actually went is in the free
 * text the admin typed, which no script should be guessing at.
 */
async function offlineBalancesWithNoAccount(db) {
  return db
    .collection("orders")
    .find({
      preorderBalancePaymentIntentId: { $regex: "^offline:" },
      preorderBalancePaidFrom: { $exists: false },
    })
    .project({ orderNumber: 1, total: 1, currency: 1 })
    .limit(50)
    .toArray();
}

async function main() {
  const { MONGODB_URI, MONGODB_DB_NAME } = process.env;
  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection.db;
  if (!AS_JSON) console.log(`connected to ${db?.databaseName}\n`);

  const findings = [
    ...(await posInTheTill(db)),
    ...(await manualInTheGateway(db)),
    // A net of zero is a sale and its refund cancelling out; nothing is left
    // in the wrong account to move.
  ].filter((row) => row.amount !== 0);
  const unknownBalances = await offlineBalancesWithNoAccount(db);

  if (AS_JSON) {
    console.log(JSON.stringify({ findings, unknownBalances }, null, 2));
  } else {
    if (findings.length === 0) {
      console.log("✓ Nothing to correct — every cash account holds its own money.");
    } else {
      console.log("Post these from Finance → Overview → Post adjustment:\n");
      for (const row of findings) {
        console.log(
          `  ${row.currency}  debit ${row.debit}  credit ${row.credit}  ${row.amount}`,
        );
        console.log(
          `      ${row.documents} ${row.what}, ${row.entries} entr(ies)\n`,
        );
      }
      console.log(
        "Reason to record on each: booked before the posting rule read how the\n" +
          "money actually arrived.\n",
      );
    }

    if (unknownBalances.length > 0) {
      console.log(
        `${unknownBalances.length} pre-order balance(s) were recorded offline before the\n` +
          "account was asked for, so they were booked wherever the deposit went.\n" +
          "Check how each actually arrived and correct any that were not the gateway:",
      );
      for (const order of unknownBalances) {
        console.log(`  ${order.orderNumber}  ${order.total} ${order.currency || ""}`);
      }
    }
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("❌", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
