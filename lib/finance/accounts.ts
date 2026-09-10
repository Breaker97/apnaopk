/**
 * The chart of accounts, fixed in code.
 *
 * Deliberately NOT a collection the admin can edit. Every posting rule names
 * two of these constants; the moment a buyer could rename or delete one, a rule
 * would point at nothing and the ledger would start recording entries against
 * an account that no report knows about. Display names are translated like any
 * other string — what is frozen is the identifier, not the wording.
 *
 * Each account has a TYPE, and the type is what makes a report possible without
 * anyone writing a report-specific query: income minus expense is the profit,
 * assets minus liabilities is the position. It also fixes the sign convention,
 * which is the part people get wrong: a debit increases an asset or an expense
 * and decreases everything else.
 */

export const LEDGER_ACCOUNT = {
  /** Money sitting with a payment gateway, not yet paid out to the bank. */
  CASH_GATEWAY: "cash_gateway",
  /** Money in the marketplace's own bank account. */
  CASH_BANK: "cash_bank",
  /** Notes and coins in a register, and cash a vendor collected on delivery. */
  CASH_ON_HAND: "cash_on_hand",
  /** Stock owned by the store itself; only the own-store book uses it. */
  INVENTORY: "inventory",
  /** Owed BY the marketplace to a vendor — their share, until the payout clears. */
  VENDOR_PAYABLE: "vendor_payable",
  /** Owed TO the marketplace by a vendor: commission on a sale they collected. */
  COMMISSION_RECEIVABLE: "commission_receivable",
  /**
   * Owed TO the store by a shopper: the balance of a part-paid order.
   *
   * A deposit-mode pre-order is a completed sale with only part of the money
   * collected. Booking the whole total as cash claimed a balance no account
   * held; booking only the deposit lost the revenue. This is the third answer,
   * and the only one that is both: the sale posts in full and the uncollected
   * part sits here until it arrives.
   */
  CUSTOMER_RECEIVABLE: "customer_receivable",
  /*
   * There is deliberately no `vendor_receivable` or `carrier_receivable`.
   *
   * Both were declared ahead of a rule that could write them, and neither rule
   * arrived. Labels are not recharged to vendors — see `shipmentLabelPostings`
   * for why that is a decision — so nothing can ever debit the first. And
   * nothing in this codebase learns that a courier has remitted the cash it
   * collected, so the second could only grow: an asset that never clears is a
   * worse answer than the cash account it would have been taken from. Either
   * comes back the day the event that settles it does.
   */
  /** Tax charged to the buyer and owed onward. */
  TAX_PAYABLE: "tax_payable",
  /**
   * Import duty collected from the buyer on a DDP sale, owed onward to the
   * carrier or the customs authority.
   *
   * Not tax, and emphatically not merchandise. It used to be neither: duty is
   * added to `order.total` after the totals are computed, and the posting rule
   * took merchandise as "everything that is not tax or shipping" — so a
   * marketplace paid its vendors a share of the customs bill and booked
   * commission on it.
   */
  DUTY_PAYABLE: "duty_payable",
  /**
   * A bill received and not yet paid — rent invoiced, a supplier on terms.
   *
   * Distinct from `vendor_payable`, which is one specific debt: a seller's
   * share of their own sales. An unpaid expense used to credit that account,
   * which raised what the marketplace appeared to owe its sellers and, when the
   * expense named a vendor, put a rent bill on that vendor's statement as
   * though it were a sale.
   */
  ACCOUNTS_PAYABLE: "accounts_payable",

  /** Goods sold by the store itself. Marketplace sales never touch this. */
  PRODUCT_REVENUE: "product_revenue",
  /** The marketplace's cut of a vendor's sale. */
  COMMISSION_INCOME: "commission_income",
  /** Shipping charged to the buyer. */
  SHIPPING_INCOME: "shipping_income",
  BOOST_INCOME: "boost_income",
  SUBSCRIPTION_INCOME: "subscription_income",
  /** Contra-income: money handed back. Never an expense — it reverses a sale. */
  REFUNDS: "refunds",

  /** What the gateway kept. */
  PROCESSING_FEES: "processing_fees",
  /** What a carrier label cost. */
  SHIPPING_COST: "shipping_cost",
  /** Cost of goods sold, from the line-level cost snapshot. */
  COST_OF_GOODS: "cost_of_goods",
  /** Everything entered by hand — rent, salaries, ads. Phase 3 fills this in. */
  OPERATING_EXPENSE: "operating_expense",
} as const;

export type LedgerAccount =
  (typeof LEDGER_ACCOUNT)[keyof typeof LEDGER_ACCOUNT];

/**
 * Every account, as a list — for the places that have to accept one by name.
 *
 * Derived from the map above rather than written out again, so an account added
 * there is immediately valid input and cannot be half-added: the failure this
 * avoids is a new account that posts fine internally but is rejected by the
 * schema that validates a hand-entered adjustment.
 */
export const LEDGER_ACCOUNTS = Object.values(
  LEDGER_ACCOUNT,
) as LedgerAccount[];

export const LEDGER_ACCOUNT_TYPE = {
  ASSET: "asset",
  LIABILITY: "liability",
  INCOME: "income",
  EXPENSE: "expense",
} as const;

type LedgerAccountType =
  (typeof LEDGER_ACCOUNT_TYPE)[keyof typeof LEDGER_ACCOUNT_TYPE];

export const LEDGER_ACCOUNT_TYPES: Record<LedgerAccount, LedgerAccountType> = {
  [LEDGER_ACCOUNT.CASH_GATEWAY]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.CASH_BANK]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.CASH_ON_HAND]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.INVENTORY]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.COMMISSION_RECEIVABLE]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.VENDOR_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.TAX_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.DUTY_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.ACCOUNTS_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.PRODUCT_REVENUE]: LEDGER_ACCOUNT_TYPE.INCOME,
  [LEDGER_ACCOUNT.COMMISSION_INCOME]: LEDGER_ACCOUNT_TYPE.INCOME,
  [LEDGER_ACCOUNT.SHIPPING_INCOME]: LEDGER_ACCOUNT_TYPE.INCOME,
  [LEDGER_ACCOUNT.BOOST_INCOME]: LEDGER_ACCOUNT_TYPE.INCOME,
  [LEDGER_ACCOUNT.SUBSCRIPTION_INCOME]: LEDGER_ACCOUNT_TYPE.INCOME,
  // Contra-income: it lives on the income side of the report and reduces it.
  // Typing it as an expense would move refunds into operating costs, where
  // they would quietly inflate both revenue and expenses by the same amount.
  [LEDGER_ACCOUNT.REFUNDS]: LEDGER_ACCOUNT_TYPE.INCOME,
  [LEDGER_ACCOUNT.PROCESSING_FEES]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT.SHIPPING_COST]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT.COST_OF_GOODS]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT.OPERATING_EXPENSE]: LEDGER_ACCOUNT_TYPE.EXPENSE,
};

/**
 * Which book an entry belongs to.
 *
 * `own` is the admin-owned store, where the marketplace IS the seller and books
 * full revenue and cost of goods. `marketplace` is everything earned as an
 * agent — commission, subscriptions, boosts — where a vendor's share is a
 * liability and never revenue.
 *
 * The two are never summed into a single "revenue" line, and in single-vendor
 * mode the marketplace book is simply never written to.
 */
export const LEDGER_BOOK = {
  OWN: "own",
  MARKETPLACE: "marketplace",
} as const;

export type LedgerBook = (typeof LEDGER_BOOK)[keyof typeof LEDGER_BOOK];

/** The sign a debit applies to an account's balance. */
export function debitSign(account: LedgerAccount): 1 | -1 {
  const type = LEDGER_ACCOUNT_TYPES[account];
  return type === LEDGER_ACCOUNT_TYPE.ASSET ||
    type === LEDGER_ACCOUNT_TYPE.EXPENSE
    ? 1
    : -1;
}

/** True for accounts that belong on the profit and loss rather than the balance. */
export function isProfitAndLossAccount(account: LedgerAccount): boolean {
  const type = LEDGER_ACCOUNT_TYPES[account];
  return (
    type === LEDGER_ACCOUNT_TYPE.INCOME || type === LEDGER_ACCOUNT_TYPE.EXPENSE
  );
}
