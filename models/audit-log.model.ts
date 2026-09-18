/**
 * Audit Log Model
 * Tracks critical administrative actions for security, compliance, and debugging
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";

/**
 * Types of actions that can be audited
 */
export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  | "SETTINGS_CHANGE"
  | "STATUS_CHANGE"
  /**
   * A status moved somewhere the workflow does not allow — an admin correcting
   * a misclick. Deliberately its own action rather than a `STATUS_CHANGE` with
   * a note: "who has been overriding the state machine, and why" is a question
   * a compliance reviewer asks directly, and it should be a filter, not a
   * search through the summaries of every ordinary transition.
   */
  | "STATUS_OVERRIDE"
  | "ROLE_CHANGE"
  | "PERMISSION_CHANGE"
  | "APPROVAL"
  | "REJECTION"
  | "SUSPENSION"
  | "PAYMENT"
  | "REFUND"
  | "EXPORT"
  | "BULK_ACTION";

/**
 * Types of resources that can be audited
 */
/**
 * The resource list, exported so a test can hold the mongoose enum against the
 * TypeScript union. They are two separate declarations of the same fact, and
 * only one of them is enforced at write time.
 */
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
  /**
   * A hand-entered ledger correction. The only write in finance with no source
   * document standing behind it, which is exactly why it has to be auditable:
   * the audit row is the record of who decided a balance was wrong.
   */
  "ledgerAdjustment",
] as const;

export type AuditResource = (typeof AUDIT_RESOURCES)[number];

/**
 * Audit log document interface
 */
export interface IAuditLog extends Document {
  /** The type of action performed */
  action: AuditAction;

  /** The type of resource affected */
  resource: AuditResource;

  /** The ID of the affected resource (if applicable) */
  resourceId?: string;

  /** Human-readable description of the resource */
  resourceName?: string;

  /** The user who performed the action */
  userId?: Types.ObjectId;

  /** Email of the user who performed the action */
  userEmail?: string;

  /** Role of the user at the time of action */
  userRole?: string;

  /** Details of what changed */
  changes?: {
    /** State before the change */
    before?: Record<string, unknown>;
    /** State after the change */
    after?: Record<string, unknown>;
    /** List of fields that changed */
    fields?: string[];
    /** Summary description of the change */
    summary?: string;
  };

  /** Additional metadata about the request */
  metadata?: {
    /** Client IP address */
    ip?: string;
    /** User agent string */
    userAgent?: string;
    /** Unique request identifier */
    requestId?: string;
    /** HTTP method used */
    method?: string;
    /** Request path */
    path?: string;
    /** Additional context */
    [key: string]: unknown;
  };

  /** Whether the action was successful */
  success: boolean;

  /** Error message if action failed */
  errorMessage?: string;

  /** Timestamp of the action */
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      required: true,
      enum: [
        "CREATE",
        "UPDATE",
        "DELETE",
        "LOGIN",
        "LOGOUT",
        "LOGIN_FAILED",
        "PASSWORD_CHANGE",
        "PASSWORD_RESET",
        "SETTINGS_CHANGE",
        "STATUS_CHANGE",
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
      ],
    },
    resource: {
      type: String,
      required: true,
      // The exported list, not a second copy: the two used to drift, and a
      // resource missing here fails validation at write time.
      enum: AUDIT_RESOURCES,
    },
    resourceId: {
      type: String,
    },
    resourceName: {
      type: String,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    userEmail: {
      type: String,
    },
    userRole: {
      type: String,
    },
    changes: {
      before: {
        type: Schema.Types.Mixed,
      },
      after: {
        type: Schema.Types.Mixed,
      },
      fields: [String],
      summary: String,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    success: {
      type: Boolean,
      default: true,
    },
    errorMessage: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "audit_logs",
  },
);

// Compound indexes for common query patterns
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ resource: 1, resourceId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ resource: 1, action: 1, createdAt: -1 });
AuditLogSchema.index({ success: 1, createdAt: -1 });

/**
 * TTL index — auto-delete logs after the retention window.
 *
 * This was 90 days, which is shorter than a card chargeback window (up to 120
 * days on most schemes, longer in some jurisdictions) and shorter than most
 * statutory bookkeeping periods. Since order audit rows are what the admin
 * order Timeline renders, a 90-day expiry silently erased an order's history
 * while the order itself was still on file. 24 months clears both.
 *
 * Mongo will NOT change `expireAfterSeconds` on an index that already exists,
 * so existing databases need `pnpm db:migrate audit-indexes` (which drops and
 * recreates it); autoIndex alone leaves them on the old 90-day window.
 */
const AUDIT_LOG_RETENTION_DAYS = 730;

AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 },
);

// Virtual for formatted timestamp
AuditLogSchema.virtual("formattedDate").get(function () {
  return this.createdAt?.toISOString();
});

// Ensure virtuals are included in JSON output
AuditLogSchema.set("toJSON", { virtuals: true });
AuditLogSchema.set("toObject", { virtuals: true });

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
