/**
 * Expense categories.
 *
 * A fixed list, like the chart of accounts and for the same reason: every
 * category maps to a ledger account, and a category a buyer could delete would
 * leave expenses pointing at nothing. What a store actually wants to vary is
 * the WORDING, and that is translation, not configuration.
 *
 * The list is deliberately short. A dozen recognisable buckets is what makes a
 * profit and loss readable; thirty makes it a data-entry chore and every report
 * a long tail of ones. `other` exists so nothing is unrecordable, and a store
 * that leans on it heavily has told you which bucket to add next.
 */

export const EXPENSE_CATEGORY = {
  /** Rent, utilities, insurance — the cost of existing. */
  PREMISES: "premises",
  /** Salaries, contractors, freelancers. */
  PEOPLE: "people",
  /** Ads, promotions, content, sponsorships. */
  MARKETING: "marketing",
  /** Hosting, SaaS, domains, software licences. */
  SOFTWARE: "software",
  /** Stock bought for resale, when it is not already a per-line cost. */
  INVENTORY_PURCHASE: "inventory_purchase",
  /** Packaging, couriers and postage paid outside a carrier label. */
  SHIPPING_SUPPLIES: "shipping_supplies",
  /** Bank charges, gateway fees paid off-platform, currency spreads. */
  BANK_FEES: "bank_fees",
  /** Accountants, lawyers, consultants. */
  PROFESSIONAL: "professional",
  /** Equipment, furniture, devices. */
  EQUIPMENT: "equipment",
  /** Travel, meals, entertainment. */
  TRAVEL: "travel",
  /** Taxes and duties paid, not the sales tax collected from buyers. */
  TAXES: "taxes",
  OTHER: "other",
} as const;

export type ExpenseCategory =
  (typeof EXPENSE_CATEGORY)[keyof typeof EXPENSE_CATEGORY];

export const EXPENSE_CATEGORIES = Object.values(EXPENSE_CATEGORY);

/** English fallbacks; the UI prefers `finance.expenseCategory.<key>`. */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  [EXPENSE_CATEGORY.PREMISES]: "Rent & utilities",
  [EXPENSE_CATEGORY.PEOPLE]: "Salaries & contractors",
  [EXPENSE_CATEGORY.MARKETING]: "Marketing & advertising",
  [EXPENSE_CATEGORY.SOFTWARE]: "Software & hosting",
  [EXPENSE_CATEGORY.INVENTORY_PURCHASE]: "Stock purchases",
  [EXPENSE_CATEGORY.SHIPPING_SUPPLIES]: "Packaging & postage",
  [EXPENSE_CATEGORY.BANK_FEES]: "Bank & payment fees",
  [EXPENSE_CATEGORY.PROFESSIONAL]: "Professional services",
  [EXPENSE_CATEGORY.EQUIPMENT]: "Equipment",
  [EXPENSE_CATEGORY.TRAVEL]: "Travel & meals",
  [EXPENSE_CATEGORY.TAXES]: "Taxes & duties",
  [EXPENSE_CATEGORY.OTHER]: "Other",
};

/**
 * Words the category search matches besides the label.
 *
 * What people type is what they paid for, and the labels rarely contain it:
 * "salary" is not a substring of "Salaries", and nobody filing a Meta invoice
 * types "marketing". English only; a translated label is still matched on its
 * own words.
 */
export const EXPENSE_CATEGORY_KEYWORDS: Record<ExpenseCategory, string> = {
  [EXPENSE_CATEGORY.PREMISES]:
    "rent lease office shop warehouse electricity water gas internet insurance",
  [EXPENSE_CATEGORY.PEOPLE]:
    "salary wages payroll staff employee contractor freelancer bonus",
  [EXPENSE_CATEGORY.MARKETING]:
    "ads facebook meta google instagram tiktok promotion influencer sponsorship seo",
  [EXPENSE_CATEGORY.SOFTWARE]:
    "server domain saas subscription licence license app cloud email",
  [EXPENSE_CATEGORY.INVENTORY_PURCHASE]:
    "inventory goods products wholesale supplier restock",
  [EXPENSE_CATEGORY.SHIPPING_SUPPLIES]:
    "packaging boxes courier postage delivery shipping",
  [EXPENSE_CATEGORY.BANK_FEES]:
    "bank charges gateway transfer fee currency exchange",
  [EXPENSE_CATEGORY.PROFESSIONAL]:
    "accountant lawyer legal consultant audit bookkeeping",
  [EXPENSE_CATEGORY.EQUIPMENT]:
    "laptop computer phone printer furniture device hardware",
  [EXPENSE_CATEGORY.TRAVEL]: "transport taxi fuel flight hotel food",
  [EXPENSE_CATEGORY.TAXES]: "tax vat duty customs government trade licence",
  [EXPENSE_CATEGORY.OTHER]: "misc miscellaneous",
};

/** How the expense was settled — it decides which asset the money left. */
export const EXPENSE_PAID_FROM = {
  BANK: "bank",
  CASH: "cash",
  /** Taken out of the gateway balance before payout. */
  GATEWAY: "gateway",
  /** Not paid yet: it becomes a payable rather than a cash movement. */
  UNPAID: "unpaid",
} as const;

export type ExpensePaidFrom =
  (typeof EXPENSE_PAID_FROM)[keyof typeof EXPENSE_PAID_FROM];

/**
 * Which account a category's cost is debited to.
 *
 * Almost everything is an operating expense — a cost the moment it is incurred.
 * Stock is the exception, and getting it wrong cost the P&L twice: buying goods
 * for resale is not spending money, it is converting cash into an asset, and
 * the cost belongs on the profit and loss when the goods are SOLD. That posting
 * already existed (`cost_of_goods` ← `inventory`, from the line-level cost
 * snapshot), so filing the purchase as an operating expense meant a store that
 * recorded both had the same goods charged against profit on the way in and
 * again on the way out — while `inventory` itself, credited on every sale and
 * debited by nothing, fell further below zero with each one.
 *
 * Only the exception is listed. A map with every category spelled out invites a
 * new one being added to the enum and forgotten here.
 */
export const EXPENSE_CATEGORY_DEBIT_ACCOUNT: Partial<
  Record<ExpenseCategory, "inventory">
> = {
  [EXPENSE_CATEGORY.INVENTORY_PURCHASE]: "inventory",
};
