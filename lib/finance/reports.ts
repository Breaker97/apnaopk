/**
 * Reports, as groupings of the ledger.
 *
 * Every figure here comes from LedgerEntry and nothing else. That is the whole
 * return on building the spine: a profit and loss is one aggregation, not a
 * re-derivation of custody, discount and refund rules that would drift from the
 * ones the posting layer already applied.
 *
 * Two rules the numbers depend on:
 *
 * **Never sum across currencies.** Every total is grouped by the currency it
 * was recorded in. Adding UGX to USD produces a number denominated in nothing,
 * and it is the failure mode this module exists to avoid — the old sales
 * roll-up did exactly that and said so in its own comment.
 *
 * **GMV is not revenue.** On a marketplace the merchandise flowing through the
 * platform mostly belongs to vendors, so it is reported as its own figure,
 * beside revenue and never inside it.
 */

import { Types } from "mongoose";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { Order } from "@/models/order.model";
import { LEDGER_SOURCE_KIND } from "@/models/ledger-entry.model";
import {
  LEDGER_ACCOUNT,
  LEDGER_ACCOUNT_TYPE,
  LEDGER_ACCOUNT_TYPES,
  type LedgerAccount,
  type LedgerBook,
} from "@/lib/finance/accounts";
import { roundMoney } from "@/lib/intl/money";

interface AccountLine {
  account: LedgerAccount;
  /** Positive when the account moved in its natural direction. */
  amount: number;
}

export interface ProfitAndLoss {
  currency: string;
  income: AccountLine[];
  expenses: AccountLine[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
  /** shipping_income − shipping_cost, the one figure the carrier work unlocked. */
  shippingMargin: number;
  /** True when any entry in the period had its currency assumed. */
  hasAssumedCurrency: boolean;
}

export interface FinancePeriod {
  from: Date;
  to: Date;
}

function periodMatch(period: FinancePeriod, book?: LedgerBook) {
  return {
    date: { $gte: period.from, $lte: period.to },
    ...(book ? { book } : {}),
  };
}

const round = (value: number) => roundMoney(value);

/**
 * Profit and loss for a period, one entry per currency.
 *
 * Income accounts are credit-natured and expenses debit-natured, so each side
 * is summed in its own direction and both come out positive — except a contra
 * account like refunds, which lands negative inside income and reduces it,
 * exactly as it should.
 */
export async function getProfitAndLoss(
  period: FinancePeriod,
  book?: LedgerBook,
): Promise<ProfitAndLoss[]> {
  const rows = await LedgerEntry.aggregate<{
    _id: { currency: string; account: LedgerAccount; side: "debit" | "credit" };
    amount: number;
  }>([
    { $match: periodMatch(period, book) },
    {
      $facet: {
        debits: [
          {
            $group: {
              _id: { currency: "$currency", account: "$debit", side: "debit" },
              amount: { $sum: "$amount" },
            },
          },
        ],
        credits: [
          {
            $group: {
              _id: { currency: "$currency", account: "$credit", side: "credit" },
              amount: { $sum: "$amount" },
            },
          },
        ],
      },
    },
    {
      $project: {
        rows: { $concatArrays: ["$debits", "$credits"] },
      },
    },
    { $unwind: "$rows" },
    { $replaceRoot: { newRoot: "$rows" } },
  ]);

  const byCurrency = new Map<
    string,
    { income: Map<LedgerAccount, number>; expenses: Map<LedgerAccount, number> }
  >();

  for (const row of rows) {
    const { currency, account, side } = row._id;
    const type = LEDGER_ACCOUNT_TYPES[account];
    // Balance-sheet accounts (cash, payables, inventory) are not profit.
    if (
      type !== LEDGER_ACCOUNT_TYPE.INCOME &&
      type !== LEDGER_ACCOUNT_TYPE.EXPENSE
    ) {
      continue;
    }
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, { income: new Map(), expenses: new Map() });
    }
    const bucket = byCurrency.get(currency)!;
    const target =
      type === LEDGER_ACCOUNT_TYPE.INCOME ? bucket.income : bucket.expenses;
    // Income rises on credits, expense on debits; the other side subtracts.
    const natural = type === LEDGER_ACCOUNT_TYPE.INCOME ? "credit" : "debit";
    const delta = side === natural ? row.amount : -row.amount;
    target.set(account, (target.get(account) ?? 0) + delta);
  }

  const assumedCurrencies = new Set(
    (
      await LedgerEntry.distinct("currency", {
        ...periodMatch(period, book),
        note: /Currency assumed/,
      })
    ).map(String),
  );

  return [...byCurrency.entries()]
    .map(([currency, bucket]) => {
      const income = [...bucket.income.entries()]
        .map(([account, amount]) => ({ account, amount: round(amount) }))
        .filter((line) => line.amount !== 0)
        .sort((a, b) => b.amount - a.amount);
      const expenses = [...bucket.expenses.entries()]
        .map(([account, amount]) => ({ account, amount: round(amount) }))
        .filter((line) => line.amount !== 0)
        .sort((a, b) => b.amount - a.amount);

      const totalIncome = round(
        income.reduce((sum, line) => sum + line.amount, 0),
      );
      const totalExpenses = round(
        expenses.reduce((sum, line) => sum + line.amount, 0),
      );
      const shippingIncome =
        income.find((l) => l.account === LEDGER_ACCOUNT.SHIPPING_INCOME)
          ?.amount ?? 0;
      const shippingCost =
        expenses.find((l) => l.account === LEDGER_ACCOUNT.SHIPPING_COST)
          ?.amount ?? 0;

      return {
        currency,
        income,
        expenses,
        totalIncome,
        totalExpenses,
        net: round(totalIncome - totalExpenses),
        shippingMargin: round(shippingIncome - shippingCost),
        hasAssumedCurrency: assumedCurrencies.has(currency),
      };
    })
    .sort((a, b) => b.totalIncome - a.totalIncome);
}

export interface CashPosition {
  currency: string;
  gateway: number;
  bank: number;
  onHand: number;
  /**
   * Stock the store owns, at what it paid.
   *
   * Computed all along and mapped nowhere, so the account was write-only: no
   * screen could show it and nothing noticed it going negative. It is the other
   * half of cost of goods — the sale credits it, the purchase debits it — and
   * an admin who cannot see it has no way to tell that stock is being sold
   * without ever having been booked in.
   */
  inventory: number;
  /** Owed to vendors — money held on their behalf, not the platform's. */
  vendorPayable: number;
  /** Owed by vendors — commission on sales they collected themselves. */
  receivable: number;
  /** Owed by shoppers — the balance of a part-paid order. */
  customerReceivable: number;
  taxPayable: number;
  /** Import duty collected on a DDP sale and owed onward. */
  dutyPayable: number;
  /** Bills received and not paid yet. */
  accountsPayable: number;
}

/** A balance the books say is impossible, and which account said it. */
export interface LedgerAnomaly {
  currency: string;
  account: LedgerAccount;
  amount: number;
  /** Which impossibility it is — the two read differently to an admin. */
  kind: "negative-cash" | "negative-liability";
}

/**
 * Balances that cannot be true, read off a position already computed.
 *
 * A liability below zero says the platform handed over more than it ever owed;
 * a cash account below zero says it holds less than nothing. Neither is a
 * rounding artefact and neither fixes itself — the entries behind them are
 * facts, and the ledger is append-only — so the only thing that resolves one is
 * a correcting entry someone decides to post.
 *
 * Surfaced because the alternative is what these screens did until now: print
 * `-$18,587.73` under "Held on their behalf until a payout clears" and leave it
 * reading like an ordinary figure. The ledger's own header promises "a bug
 * alarm no test could otherwise raise"; this is the part that rings it.
 *
 * Pure, and separate from the aggregation, so the rule can be asserted without
 * a database — and so a screen that already has a position pays nothing to ask.
 */
export function findLedgerAnomalies(
  positions: ReadonlyArray<CashPosition>,
): LedgerAnomaly[] {
  const anomalies: LedgerAnomaly[] = [];

  for (const position of positions) {
    const check = (
      account: LedgerAccount,
      amount: number,
      kind: LedgerAnomaly["kind"],
    ) => {
      // Strictly below zero: an account that has cleared to exactly zero is the
      // normal resting state, not a fault.
      if (amount < 0) {
        anomalies.push({ currency: position.currency, account, amount, kind });
      }
    };

    check(LEDGER_ACCOUNT.CASH_GATEWAY, position.gateway, "negative-cash");
    check(LEDGER_ACCOUNT.CASH_BANK, position.bank, "negative-cash");
    check(LEDGER_ACCOUNT.CASH_ON_HAND, position.onHand, "negative-cash");
    // Stock sold that was never booked in. Same impossibility as negative cash
    // — you cannot hold less than none of a thing — and until stock purchases
    // debited this account it was the only direction the balance could go.
    check(LEDGER_ACCOUNT.INVENTORY, position.inventory, "negative-cash");
    check(
      LEDGER_ACCOUNT.VENDOR_PAYABLE,
      position.vendorPayable,
      "negative-liability",
    );
    check(LEDGER_ACCOUNT.TAX_PAYABLE, position.taxPayable, "negative-liability");
    check(
      LEDGER_ACCOUNT.DUTY_PAYABLE,
      position.dutyPayable,
      "negative-liability",
    );
    check(
      LEDGER_ACCOUNT.ACCOUNTS_PAYABLE,
      position.accountsPayable,
      "negative-liability",
    );
  }

  // Worst first: with several, the one furthest from zero is the one to explain.
  return anomalies.sort((a, b) => a.amount - b.amount);
}

/**
 * What is held and what is owed, as of `asOf`.
 *
 * A balance rather than a period: cash is the running total of everything ever
 * posted, so this deliberately has no `from`.
 *
 * And deliberately no `book` either. The profit and loss splits by book because
 * two businesses genuinely earned two different amounts; a balance sheet does
 * not, because there is ONE bank account, ONE gateway balance and ONE till
 * behind both of them. Filtering these by book produced figures describing
 * nothing real — the own book showed a gateway holding $8,046 and the
 * marketplace $117,241, when the store has a single gateway holding $125,288 —
 * and the screen presented each as though it were the balance.
 */
export async function getCashPosition(asOf: Date): Promise<CashPosition[]> {
  const rows = await LedgerEntry.aggregate<{
    _id: { currency: string; account: LedgerAccount };
    debits: number;
    credits: number;
  }>([
    {
      $match: { date: { $lte: asOf } },
    },
    {
      $facet: {
        d: [
          {
            $group: {
              _id: { currency: "$currency", account: "$debit" },
              debits: { $sum: "$amount" },
              credits: { $sum: 0 },
            },
          },
        ],
        c: [
          {
            $group: {
              _id: { currency: "$currency", account: "$credit" },
              debits: { $sum: 0 },
              credits: { $sum: "$amount" },
            },
          },
        ],
      },
    },
    { $project: { rows: { $concatArrays: ["$d", "$c"] } } },
    { $unwind: "$rows" },
    { $replaceRoot: { newRoot: "$rows" } },
    {
      $group: {
        _id: "$_id",
        debits: { $sum: "$debits" },
        credits: { $sum: "$credits" },
      },
    },
  ]);

  const byCurrency = new Map<string, CashPosition>();
  for (const row of rows) {
    const { currency, account } = row._id;
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        currency,
        gateway: 0,
        bank: 0,
        onHand: 0,
        inventory: 0,
        vendorPayable: 0,
        receivable: 0,
        customerReceivable: 0,
        taxPayable: 0,
        dutyPayable: 0,
        accountsPayable: 0,
      });
    }
    const position = byCurrency.get(currency)!;
    const asset = round(row.debits - row.credits);
    const liability = round(row.credits - row.debits);

    if (account === LEDGER_ACCOUNT.CASH_GATEWAY) position.gateway = asset;
    else if (account === LEDGER_ACCOUNT.CASH_BANK) position.bank = asset;
    else if (account === LEDGER_ACCOUNT.CASH_ON_HAND) position.onHand = asset;
    else if (account === LEDGER_ACCOUNT.INVENTORY) position.inventory = asset;
    else if (account === LEDGER_ACCOUNT.VENDOR_PAYABLE) {
      position.vendorPayable = liability;
    } else if (account === LEDGER_ACCOUNT.COMMISSION_RECEIVABLE) {
      position.receivable = asset;
    } else if (account === LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE) {
      position.customerReceivable = asset;
    } else if (account === LEDGER_ACCOUNT.TAX_PAYABLE) {
      position.taxPayable = liability;
    } else if (account === LEDGER_ACCOUNT.DUTY_PAYABLE) {
      position.dutyPayable = liability;
    } else if (account === LEDGER_ACCOUNT.ACCOUNTS_PAYABLE) {
      position.accountsPayable = liability;
    }
  }
  return [...byCurrency.values()];
}

export interface VendorLedgerBalance {
  /**
   * `vendorId:currency` — unique per ROW, which `vendorId` is not.
   *
   * A vendor trading in two currencies is two balances and must stay two rows;
   * keying the table on the vendor alone gave them the same React key, which
   * collapses them in reconciliation and makes row selection pick both.
   */
  id: string;
  vendorId: string;
  storeName: string;
  currency: string;
  /** Held by the platform on the vendor's behalf, awaiting a payout. */
  payable: number;
  /** Commission the vendor owes on sales they collected themselves. */
  receivable: number;
  /** payable − receivable: what a settlement would actually move. */
  net: number;
}

/**
 * What each vendor is owed and owes, from the ledger.
 *
 * Both directions in one place because they offset: a vendor sitting on
 * self-collected cash may owe more commission than the platform holds for them,
 * and paying out the gross while chasing the commission separately is how a
 * marketplace ends up funding its own sellers. `net` is what a settlement
 * actually moves.
 *
 * Read from entries rather than from Payout and the order flags, so the figure
 * agrees with the profit and loss by construction — the two cannot drift into
 * telling a vendor different things on different screens.
 */
export async function getVendorLedgerBalances(
  asOf: Date = new Date(),
): Promise<VendorLedgerBalance[]> {
  const rows = await LedgerEntry.aggregate<{
    _id: { vendorId: unknown; currency: string; account: LedgerAccount };
    debits: number;
    credits: number;
  }>([
    {
      $match: {
        date: { $lte: asOf },
        vendorId: { $ne: null },
        $or: [
          { debit: { $in: [LEDGER_ACCOUNT.VENDOR_PAYABLE, LEDGER_ACCOUNT.COMMISSION_RECEIVABLE] } },
          { credit: { $in: [LEDGER_ACCOUNT.VENDOR_PAYABLE, LEDGER_ACCOUNT.COMMISSION_RECEIVABLE] } },
        ],
      },
    },
    {
      $facet: {
        d: [
          {
            $match: {
              debit: {
                $in: [
                  LEDGER_ACCOUNT.VENDOR_PAYABLE,
                  LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
                ],
              },
            },
          },
          {
            $group: {
              _id: {
                vendorId: "$vendorId",
                currency: "$currency",
                account: "$debit",
              },
              debits: { $sum: "$amount" },
              credits: { $sum: 0 },
            },
          },
        ],
        c: [
          {
            $match: {
              credit: {
                $in: [
                  LEDGER_ACCOUNT.VENDOR_PAYABLE,
                  LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
                ],
              },
            },
          },
          {
            $group: {
              _id: {
                vendorId: "$vendorId",
                currency: "$currency",
                account: "$credit",
              },
              debits: { $sum: 0 },
              credits: { $sum: "$amount" },
            },
          },
        ],
      },
    },
    { $project: { rows: { $concatArrays: ["$d", "$c"] } } },
    { $unwind: "$rows" },
    { $replaceRoot: { newRoot: "$rows" } },
    {
      $group: {
        _id: "$_id",
        debits: { $sum: "$debits" },
        credits: { $sum: "$credits" },
      },
    },
  ]);

  const byVendor = new Map<string, VendorLedgerBalance>();
  for (const row of rows) {
    const vendorId = String(row._id.vendorId || "");
    if (!vendorId) continue;
    const key = `${vendorId}:${row._id.currency}`;
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        id: key,
        vendorId,
        storeName: "",
        currency: row._id.currency,
        payable: 0,
        receivable: 0,
        net: 0,
      });
    }
    const balance = byVendor.get(key)!;
    if (row._id.account === LEDGER_ACCOUNT.VENDOR_PAYABLE) {
      // A liability: credits raise it.
      balance.payable = round(balance.payable + row.credits - row.debits);
    } else {
      balance.receivable = round(balance.receivable + row.debits - row.credits);
    }
    balance.net = round(balance.payable - balance.receivable);
  }

  const balances = [...byVendor.values()].filter(
    (balance) => balance.payable !== 0 || balance.receivable !== 0,
  );
  if (balances.length === 0) return [];

  // Names last, over the vendors that actually have a balance.
  const { Vendor } = await import("@/models/vendor.model");
  const vendors = await Vendor.find({
    _id: { $in: balances.map((balance) => balance.vendorId) },
  })
    .select("_id storeName")
    .lean<Array<{ _id: unknown; storeName?: string }>>();
  const nameById = new Map(
    vendors.map((vendor) => [String(vendor._id), vendor.storeName || ""]),
  );
  for (const balance of balances) {
    balance.storeName = nameById.get(balance.vendorId) || "";
  }

  return balances.sort(
    (a, b) => Math.abs(b.net) - Math.abs(a.net) || a.storeName.localeCompare(b.storeName),
  );
}

export interface VendorStatementLine {
  date: string;
  /** What happened, as an account pair the vendor can recognise. */
  kind:
    | "sale"
    | "commission"
    | "refund"
    | "payout"
    | "boost"
    | "subscription"
    | "other";
  reference: string;
  currency: string;
  /**
   * Which balance the line moves. Commission on a sale the vendor collected
   * themselves does NOT reduce what the marketplace holds for them — it raises
   * what they owe — and showing both in one signed column made the statement
   * read as though every commission had been deducted from their money.
   */
  affects: "held" | "owed";
  /** Positive in the direction of the balance it affects. */
  amount: number;
}

interface VendorStatement {
  currency: string;
  /** Balance carried in from before the period. */
  opening: number;
  earned: number;
  commission: number;
  refunded: number;
  paidOut: number;
  /**
   * Hand-posted corrections that moved this vendor's held balance.
   *
   * Split out of `earned` because they are not sales. A write-off of money the
   * platform paid but never collected credits the same account a sale does, so
   * without this the vendor's statement reported the platform absorbing a loss
   * as income the vendor had earned.
   */
  adjustments: number;
  /** What the platform holds for them at the end of the period. */
  closing: number;
  /** Commission owed on sales they collected themselves. */
  owed: number;
  lines: VendorStatementLine[];
  /** Entries in the period, which may exceed the lines actually listed. */
  lineCount: number;
  /** True when `lines` is a page of a longer period rather than all of it. */
  truncated: boolean;
}

/**
 * How many entries a statement lists.
 *
 * The totals never depend on it — they are aggregated over the whole period —
 * so a busy vendor gets a correct closing balance with a readable list under
 * it, rather than the silently wrong balance that came of adding up whichever
 * five hundred rows happened to be fetched.
 */
const STATEMENT_LINE_LIMIT = 500;

/**
 * One vendor's period, from their side of the ledger.
 *
 * A statement rather than a report: it opens with what was carried in, lists
 * what moved, and closes with a balance — which is the shape anyone who has
 * ever read a bank statement already knows how to check. The alternative, a
 * pile of totals, is exactly what makes a vendor open a ticket asking why the
 * number is what it is.
 *
 * The vendor's own entries are the source, so what they see and what the
 * marketplace sees on the Receivables screen are the same rows.
 */
export async function getVendorStatement(
  vendorId: string,
  period: FinancePeriod,
): Promise<VendorStatement[]> {
  const vendorObjectId = new Types.ObjectId(String(vendorId));
  const accounts = [
    LEDGER_ACCOUNT.VENDOR_PAYABLE,
    LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
  ];

  // Only these entries become a line, so the line query filters on them too —
  // otherwise the page limit is spent on entries that render nothing.
  const lineMatch = {
    $or: [
      { credit: LEDGER_ACCOUNT.VENDOR_PAYABLE },
      { debit: LEDGER_ACCOUNT.VENDOR_PAYABLE },
      { debit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE },
      { credit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE },
    ],
  };
  /** The same rule as an aggregation expression, for the count. */
  const producesLine = {
    $or: [
      { $eq: ["$credit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
      { $eq: ["$debit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
      { $eq: ["$debit", LEDGER_ACCOUNT.COMMISSION_RECEIVABLE] },
      { $eq: ["$credit", LEDGER_ACCOUNT.COMMISSION_RECEIVABLE] },
    ],
  };
  const sumWhen = (condition: unknown) => ({
    $cond: [condition, "$amount", 0],
  });

  const [openingRows, totalRows, entries] = await Promise.all([
    // Everything before the period, folded into one number per currency.
    LedgerEntry.aggregate<{ _id: string; debits: number; credits: number }>([
      {
        $match: {
          vendorId: vendorObjectId,
          date: { $lt: period.from },
          $or: [{ debit: { $in: accounts } }, { credit: { $in: accounts } }],
        },
      },
      {
        $group: {
          _id: "$currency",
          credits: {
            $sum: {
              $cond: [
                { $eq: ["$credit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
                "$amount",
                0,
              ],
            },
          },
          debits: {
            $sum: {
              $cond: [
                { $eq: ["$debit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
                "$amount",
                0,
              ],
            },
          },
        },
      },
    ]),
    // The totals, over the WHOLE period. They used to be added up from the page
    // of lines below, so a vendor busy enough to fill it was shown a closing
    // balance computed from an arbitrary five hundred of their entries — wrong,
    // and wrong silently, since nothing on the screen said the list was partial.
    LedgerEntry.aggregate<{
      _id: string;
      earned: number;
      payableOut: number;
      paidOut: number;
      commission: number;
      owedUp: number;
      owedDown: number;
      adjustmentsUp: number;
      adjustmentsDown: number;
      lineCount: number;
    }>([
      {
        $match: {
          vendorId: vendorObjectId,
          date: { $gte: period.from, $lte: period.to },
        },
      },
      {
        $group: {
          _id: "$currency",
          // Sales only: an adjustment credits the same account and is counted
          // on its own line below.
          earned: {
            $sum: sumWhen({
              $and: [
                { $eq: ["$credit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
                { $ne: ["$source.kind", LEDGER_SOURCE_KIND.ADJUSTMENT] },
              ],
            }),
          },
          adjustmentsUp: {
            $sum: sumWhen({
              $and: [
                { $eq: ["$credit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
                { $eq: ["$source.kind", LEDGER_SOURCE_KIND.ADJUSTMENT] },
              ],
            }),
          },
          adjustmentsDown: {
            $sum: sumWhen({
              $and: [
                { $eq: ["$debit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
                { $eq: ["$source.kind", LEDGER_SOURCE_KIND.ADJUSTMENT] },
              ],
            }),
          },
          payableOut: {
            $sum: sumWhen({
              $and: [
                { $eq: ["$debit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
                { $ne: ["$source.kind", LEDGER_SOURCE_KIND.ADJUSTMENT] },
              ],
            }),
          },
          // Identified by what PRODUCED the entry, not by which cash account
          // it happened to credit. `payoutPaidPostings` credits the bank today,
          // so pattern-matching on that account worked — right up until a
          // payout leaves from the gateway or the till, at which point the
          // money would be reported to the vendor as a refund of their own
          // sales. The source kind is the fact; the account pair is a detail
          // of one posting rule.
          paidOut: {
            $sum: sumWhen({
              $and: [
                { $eq: ["$debit", LEDGER_ACCOUNT.VENDOR_PAYABLE] },
                { $eq: ["$source.kind", LEDGER_SOURCE_KIND.PAYOUT] },
              ],
            }),
          },
          commission: {
            $sum: sumWhen({
              $eq: ["$credit", LEDGER_ACCOUNT.COMMISSION_INCOME],
            }),
          },
          owedUp: {
            $sum: sumWhen({
              $eq: ["$debit", LEDGER_ACCOUNT.COMMISSION_RECEIVABLE],
            }),
          },
          owedDown: {
            $sum: sumWhen({
              $eq: ["$credit", LEDGER_ACCOUNT.COMMISSION_RECEIVABLE],
            }),
          },
          lineCount: { $sum: { $cond: [producesLine, 1, 0] } },
        },
      },
    ]),
    LedgerEntry.find({
      vendorId: vendorObjectId,
      date: { $gte: period.from, $lte: period.to },
      ...lineMatch,
    })
      .sort({ date: 1, _id: 1 })
      .limit(STATEMENT_LINE_LIMIT)
      .lean<
        Array<{
          date: Date;
          debit: LedgerAccount;
          credit: LedgerAccount;
          amount: number;
          currency: string;
          source?: { kind?: string; ref?: string | null };
        }>
      >(),
  ]);

  const byCurrency = new Map<string, VendorStatement>();
  const ensure = (currency: string) => {
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        currency,
        opening: 0,
        earned: 0,
        commission: 0,
        refunded: 0,
        paidOut: 0,
        adjustments: 0,
        closing: 0,
        owed: 0,
        lines: [],
        lineCount: 0,
        truncated: false,
      });
    }
    return byCurrency.get(currency)!;
  };

  for (const row of openingRows) {
    ensure(String(row._id)).opening = round(row.credits - row.debits);
  }

  for (const row of totalRows) {
    const statement = ensure(String(row._id));
    statement.earned = round(row.earned);
    statement.paidOut = round(row.paidOut);
    // Everything that lowered the payable other than a payout: a refund handing
    // the vendor's share back.
    statement.refunded = round(row.payableOut - row.paidOut);
    statement.commission = round(row.commission);
    statement.adjustments = round(row.adjustmentsUp - row.adjustmentsDown);
    statement.owed = round(row.owedUp - row.owedDown);
    statement.lineCount = row.lineCount;
  }

  for (const entry of entries) {
    const statement = ensure(entry.currency);
    const raisesPayable = entry.credit === LEDGER_ACCOUNT.VENDOR_PAYABLE;
    const lowersPayable = entry.debit === LEDGER_ACCOUNT.VENDOR_PAYABLE;
    const raisesOwed = entry.debit === LEDGER_ACCOUNT.COMMISSION_RECEIVABLE;
    const lowersOwed = entry.credit === LEDGER_ACCOUNT.COMMISSION_RECEIVABLE;

    // Checked before anything else: a correction credits the same account a
    // sale does, and reading it as a sale told the vendor they had earned the
    // platform's write-off.
    const kind: VendorStatementLine["kind"] = entry.source?.kind ===
    LEDGER_SOURCE_KIND.ADJUSTMENT
      ? "other"
      : raisesPayable
      ? "sale"
      : lowersPayable && entry.source?.kind === LEDGER_SOURCE_KIND.PAYOUT
        ? "payout"
        : lowersPayable
          ? "refund"
          : entry.credit === LEDGER_ACCOUNT.COMMISSION_INCOME
            ? "commission"
            : // Settling the debt, or a refund taking part of it back off.
              lowersOwed && entry.debit === LEDGER_ACCOUNT.REFUNDS
              ? "refund"
              : lowersOwed
                ? "commission"
                : entry.credit === LEDGER_ACCOUNT.BOOST_INCOME
                  ? "boost"
                  : entry.credit === LEDGER_ACCOUNT.SUBSCRIPTION_INCOME
                    ? "subscription"
                    : "other";

    // Signed from the VENDOR's point of view: what the platform owes them.
    const held = raisesPayable
      ? entry.amount
      : lowersPayable
        ? -entry.amount
        : 0;
    // And in the other column, what they owe: a commission on a sale they
    // collected raises it, paying the invoice brings it back down.
    const owed = raisesOwed ? entry.amount : lowersOwed ? -entry.amount : 0;

    if (held === 0 && owed === 0) continue;
    statement.lines.push({
      date: entry.date.toISOString(),
      kind,
      reference: entry.source?.ref || "",
      currency: entry.currency,
      affects: owed !== 0 ? "owed" : "held",
      // Positive in its own column: a commission of 16 raises what is owed by
      // 16, and printing it as -16 beside a sale invited the reading that the
      // marketplace had already taken it.
      amount: round(owed !== 0 ? owed : held),
    });
  }

  for (const statement of byCurrency.values()) {
    // Every movement of the payable, and nothing else: sales in, refunds and
    // payouts out, corrections either way. Leaving adjustments out of this line
    // while the ledger counted them would make the closing balance disagree
    // with the figure Receivables reports for the same vendor.
    statement.closing = round(
      statement.opening +
        statement.earned +
        statement.adjustments -
        statement.refunded -
        statement.paidOut,
    );
    statement.truncated = statement.lineCount > statement.lines.length;
  }

  return [...byCurrency.values()];
}

interface MerchandiseVolume {
  currency: string;
  amount: number;
  orders: number;
}

/**
 * Fold raw `$currency` buckets into one row per currency the screen knows.
 *
 * Exported so the rule can be asserted directly. It is the half of the GMV
 * figure that has no database in it, and the half that was wrong: a test that
 * reproduced this fold rather than calling it would have reproduced the bug
 * along with it and passed.
 *
 * Two normalisations, and each one was a way to lose money off the total:
 *
 * `null` becomes the store's currency, not the empty string. An order written
 * before the currency snapshot is posted to the ledger in the store's own
 * currency — see `loadPostingOrder` — so reporting it under `""` here put most
 * of a store's merchandise in a bucket no caller ever looks up.
 *
 * Case is folded, and rows that collide are ADDED rather than replaced. The
 * pipeline groups on the stored value, so `"usd"` and `"USD"` arrive as two
 * buckets; returning them as two rows both labelled `USD` left the caller's
 * `.find()` taking whichever came first and silently dropping the other.
 */
export function foldMerchandiseByCurrency(
  rows: ReadonlyArray<{ _id: string | null; amount: number; orders: number }>,
  fallbackCurrency: string,
): MerchandiseVolume[] {
  const assumed = fallbackCurrency.trim().toUpperCase() || "USD";
  const byCurrency = new Map<string, MerchandiseVolume>();

  for (const row of rows) {
    const currency = String(row._id || "").trim().toUpperCase() || assumed;
    const bucket = byCurrency.get(currency) ?? { currency, amount: 0, orders: 0 };
    bucket.amount += row.amount;
    bucket.orders += row.orders;
    byCurrency.set(currency, bucket);
  }

  // Rounded once, on the folded total: rounding each raw bucket before adding
  // them would drift by a cent for every bucket merged.
  return [...byCurrency.values()].map((row) => ({
    ...row,
    amount: round(row.amount),
  }));
}

/**
 * Gross merchandise value: everything that flowed through the store.
 *
 * Read from orders rather than the ledger, because it is deliberately NOT an
 * accounting figure — most of it belongs to vendors. It is reported beside
 * revenue so the two can be compared, and never added to it.
 */
export async function getGrossMerchandiseValue(
  period: FinancePeriod,
  /**
   * What an order carrying no currency of its own is counted as.
   *
   * Required rather than defaulted, because the default is the bug: an order
   * written before the currency snapshot is posted to the ledger in the store's
   * currency (see `loadPostingOrder`), so anything else here reports the same
   * sale under a currency the rest of the screen has never heard of.
   */
  fallbackCurrency: string,
  /**
   * Restrict to one book, apportioning each order between them.
   *
   * A book is a property of the CONSIGNMENT, not the order — one order can
   * carry the store's own goods on one line and a vendor's on another — so an
   * order cannot simply be assigned to a book and counted whole. It is split by
   * each book's share of the merchandise, which is the same proportion
   * `decomposeOrder` uses to split the money into entries.
   *
   * Split rather than filtered so the two books still ADD UP to the unfiltered
   * figure. Selecting orders that merely contain a book would count a mixed
   * order twice, and the card is read beside a total.
   */
  book?: LedgerBook,
  /** Vendor ids that are the admin-owned store; required only when `book` is. */
  ownVendorIds?: ReadonlySet<string>,
): Promise<MerchandiseVolume[]> {
  const ownIds = [...(ownVendorIds ?? [])].map((id) => new Types.ObjectId(id));
  /** This order's merchandise, and the part of it that is the store's own. */
  const subtotalOf = (onlyOwn: boolean) => ({
    $sum: {
      $map: {
        input: { $ifNull: ["$subOrders", []] },
        as: "sub",
        in: onlyOwn
          ? {
              $cond: [
                { $in: ["$$sub.vendorId", ownIds] },
                { $ifNull: ["$$sub.subtotal", 0] },
                0,
              ],
            }
          : { $ifNull: ["$$sub.subtotal", 0] },
      },
    },
  });

  // The order's value attributable to the book asked for. Guarded against an
  // order whose consignments carry no subtotal at all: dividing by it would
  // make the whole currency's figure null rather than just that row's.
  const attributed = book
    ? {
        $cond: [
          { $gt: ["$allSub", 0] },
          {
            $multiply: [
              "$total",
              {
                $divide: [
                  book === "own"
                    ? "$ownSub"
                    : { $subtract: ["$allSub", "$ownSub"] },
                  "$allSub",
                ],
              },
            ],
          },
          0,
        ],
      }
    : "$total";

  const rows = await Order.aggregate<{
    _id: string | null;
    amount: number;
    orders: number;
  }>([
    {
      $match: {
        createdAt: { $gte: period.from, $lte: period.to },
        paymentStatus: {
          $in: ["paid", "partially_paid", "partially_refunded", "refunded"],
        },
      },
    },
    {
      $project: {
        currency: 1,
        total: { $ifNull: ["$total", 0] },
        ownSub: subtotalOf(true),
        allSub: subtotalOf(false),
      },
    },
    { $project: { currency: 1, attributed } },
    {
      $group: {
        _id: "$currency",
        amount: { $sum: "$attributed" },
        // Only orders this book actually appears in, so "42 orders" under the
        // marketplace does not silently include the store's own counter sales.
        orders: { $sum: { $cond: [{ $gt: ["$attributed", 0] }, 1, 0] } },
      },
    },
  ]);

  // The pipeline groups on the stored value; making those buckets agree with
  // what the rest of the screen calls a currency is the fold's job.
  return foldMerchandiseByCurrency(rows, fallbackCurrency);
}

interface TaxSummary {
  currency: string;
  /** Charged to buyers on sales in the period. */
  collected: number;
  /** Handed back with refunds in the period. */
  refunded: number;
  /** What is owed onward: collected less refunded. */
  net: number;
}

/**
 * Tax collected on behalf of the state.
 *
 * Never income, which is why it has its own report rather than a line on the
 * profit and loss: it is money the store holds and passes on. Reported as
 * collected, refunded and the difference, because a return asks for all three
 * and computing the third from a single figure is where mistakes get filed.
 *
 * Deliberately NOT a tax return. Rates, thresholds, registration and
 * jurisdiction are the accountant's, and a half-correct return is worse than an
 * honest set of totals to hand them.
 */
export async function getTaxSummary(
  period: FinancePeriod,
): Promise<TaxSummary[]> {
  const rows = await LedgerEntry.aggregate<{
    _id: string;
    collected: number;
    refunded: number;
  }>([
    {
      $match: {
        ...periodMatch(period),
        $or: [
          { credit: LEDGER_ACCOUNT.TAX_PAYABLE },
          { debit: LEDGER_ACCOUNT.TAX_PAYABLE },
        ],
      },
    },
    {
      $group: {
        _id: "$currency",
        collected: {
          $sum: {
            $cond: [{ $eq: ["$credit", LEDGER_ACCOUNT.TAX_PAYABLE] }, "$amount", 0],
          },
        },
        refunded: {
          $sum: {
            $cond: [{ $eq: ["$debit", LEDGER_ACCOUNT.TAX_PAYABLE] }, "$amount", 0],
          },
        },
      },
    },
  ]);

  return rows.map((row) => ({
    currency: String(row._id || "").toUpperCase(),
    collected: round(row.collected),
    refunded: round(row.refunded),
    net: round(row.collected - row.refunded),
  }));
}

/**
 * Every currency the ledger has an entry in.
 *
 * Needed by anything that WRITES a correction: an adjustment posted in the
 * store's current currency cannot touch a balance recorded in another one — it
 * would open a second, parallel balance in the wrong denomination and leave the
 * impossible one exactly where it was. Read from the entries rather than from
 * settings, because the settings say what the store charges today and the
 * ledger says what it has actually traded in.
 */
export async function getLedgerCurrencies(): Promise<string[]> {
  const currencies = await LedgerEntry.distinct("currency");
  return [...new Set(currencies.map((c) => String(c || "").toUpperCase()))]
    .filter(Boolean)
    .sort();
}

/**
 * The period a finance screen is actually looking at.
 *
 * Either a named span — "last 30 days" — or two dates someone picked. Both live
 * in the URL for the same reason the picker's comment gives: a figure has to be
 * linkable, and "our September numbers" is a sentence people send to their
 * accountant. A named key is stored as the key rather than as the dates it
 * resolves to today, so the link still means last 30 days next week.
 *
 * An unparsable or reversed pair falls back to the named period rather than
 * erroring: a hand-edited URL should show something, not a stack trace.
 */
export function resolveRequestedPeriod(
  search: { period?: string; from?: string; to?: string },
  now = new Date(),
): FinancePeriod & { key: string } {
  const from = parseDayStart(search.from);
  const to = parseDayEnd(search.to);
  if (from && to && from <= to) return { key: "custom", from, to };
  return resolvePeriod(search.period || "30d", now);
}

/** "2026-08-27" at 00:00 UTC, or null. */
function parseDayStart(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The same day at its last instant, so a range ending "today" includes today.
 * Ending it at midnight is the off-by-a-day that makes a report quietly drop
 * its final day's takings.
 */
function parseDayEnd(value?: string): Date | null {
  const start = parseDayStart(value);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Named periods the overview offers, resolved against a clock. */
export function resolvePeriod(
  key: string,
  now = new Date(),
): FinancePeriod & { key: string } {
  const to = now;
  const start = new Date(now);
  switch (key) {
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    case "ytd":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "all":
      // The epoch, not a year somebody guessed. This was 2000-01-01, which is
      // "far enough back" only until a store imports history from before it —
      // and the figure it produced then was not marked as partial anywhere, so
      // "All time" quietly meant "since 2000".
      start.setTime(0);
      break;
    default:
      start.setDate(start.getDate() - 30);
      return { key: "30d", from: start, to };
  }
  return { key, from: start, to };
}
