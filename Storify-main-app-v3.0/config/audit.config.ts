/**
 * The audit log's vocabulary: what can be done, and to what.
 *
 * Runtime-free, like the rest of `config/`, so the Activity Log's filters and
 * badges can name an action without pulling mongoose into a client bundle.
 * `models/audit-log.model.ts` builds its schema enums from these lists and
 * re-exports them, so the schema, the TypeScript unions and the filters cannot
 * drift apart — the action list used to be written out twice, and only the
 * mongoose copy was enforced at write time.
 */

export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "LOGIN_FAILED",
  "PASSWORD_CHANGE",
  "PASSWORD_RESET",
  /** Two-factor sign-in turned on or off, or its backup codes regenerated. */
  "TWO_FACTOR_CHANGE",
  "SETTINGS_CHANGE",
  "STATUS_CHANGE",
  /**
   * A status moved somewhere the workflow does not allow — an admin correcting
   * a misclick. Deliberately its own action rather than a `STATUS_CHANGE` with
   * a note: "who has been overriding the state machine, and why" is a question
   * a compliance reviewer asks directly, and it should be a filter, not a
   * search through the summaries of every ordinary transition.
   */
  "STATUS_OVERRIDE",
  "ROLE_CHANGE",
  "PERMISSION_CHANGE",
  "APPROVAL",
  "REJECTION",
  "SUSPENSION",
  "PAYMENT",
  "REFUND",
  "EXPORT",
  "BULK_ACTION",
  /** A team invitation emailed — by an admin or by a vendor. */
  "INVITE_SENT",
] as const;

/** Types of actions that can be audited. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESOURCES = [
  "user",
  "vendor",
  "product",
  "order",
  "coupon",
  "category",
  "settings",
  "session",
  "payment",
  "refund",
  "inventory",
  "location",
  /** A stock transfer between two locations — created, shipped, received. */
  "transfer",
  "collection",
  "review",
  "vendorPlan",
  "vendorOnboardingTemplate",
  "boostPosition",
  "boostCampaign",
  "vendorSubscription",
  "expense",
  "fiscalPeriod",
  "storePage",
  /** A stored file deleted from the Media Library, by its storage key. */
  "media",
  /**
   * A hand-entered ledger correction. The only write in finance with no source
   * document standing behind it, which is exactly why it has to be auditable:
   * the audit row is the record of who decided a balance was wrong.
   */
  "ledgerAdjustment",
  /** A payout to a vendor — created, then moved through its statuses. */
  "payout",
  /** Store credit issued to a customer by hand. */
  "storeCredit",
  /** A chat channel (WhatsApp, Messenger, Instagram, Telegram) connected to an inbox. */
  "messagingChannel",
  /** Commission a vendor owes the platform on sales they collected themselves. */
  "commissionInvoice",
  /** A customer's quote request, and the price an admin offers for it. */
  "quote",
  "brand",
  /** A reusable variant option set (size, colour) shared across products. */
  "globalVariant",
  /** A storefront hero slider. */
  "slider",
  /** A storefront navigation menu. */
  "menu",
  "blogPost",
  /** A blog category: a name and a slug that every post in it is filed under. */
  "blogCategory",
] as const;

/** Types of resources that can be audited. */
export type AuditResource = (typeof AUDIT_RESOURCES)[number];
