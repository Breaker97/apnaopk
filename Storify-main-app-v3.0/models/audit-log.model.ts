/**
 * Audit Log Model
 * Tracks critical administrative actions for security, compliance, and debugging
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";

import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/config/audit.config";
import type { AuditAction, AuditResource } from "@/config/audit.config";

// The lists live in config/ so a client bundle can name an action without
// pulling mongoose in; they are re-exported here, where tests and the write
// path have always imported them from.
export { AUDIT_ACTIONS, AUDIT_RESOURCES };
export type { AuditAction, AuditResource };

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

  /**
   * The store this actor was acting for: a vendor owner's own Vendor, or the one
   * vendor a vendor-owned staff member works for. Empty for admins, platform
   * staff, customers and the system. It is the only field a vendor's log is
   * scoped on, so an admin's change to a vendor's store never reaches that
   * vendor.
   */
  actorVendorId?: Types.ObjectId;

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
      // The exported list, for the same reason as `resource` below.
      enum: AUDIT_ACTIONS,
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
    actorVendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
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

// The Activity Log lists sort `createdAt` descending, then `_id`. Ties are the
// rule here, not the exception — one request often writes several rows in the
// same millisecond — so both indexes end in `_id`: a tiebreaker the index does
// not carry would turn every page into an in-memory sort of the whole window.
// The first serves a vendor's own log, the second the admin view with no other
// filter (the TTL index below holds `createdAt` alone, so it cannot).
AuditLogSchema.index({ actorVendorId: 1, createdAt: -1, _id: -1 });
AuditLogSchema.index({ createdAt: -1, _id: -1 });

/**
 * Rows are write-once. Nothing in the app edits or removes an audit row — the
 * TTL index below expires them inside MongoDB, which these hooks never see — so
 * any such call is a bug, or someone rewriting history. It fails loudly instead
 * of quietly working.
 *
 * Covers the Mongoose paths only. The migration backfill writes through the
 * native collection, and a database user without update/delete rights on
 * `audit_logs` is the stronger guard where the host allows it.
 */
const WRITE_ONCE_QUERY_OPERATIONS = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const;

function refuseToChangeAuditRow(operation: string): never {
  throw new Error(
    `Audit log rows are write-once: ${operation} is not allowed on audit_logs.`,
  );
}

for (const operation of WRITE_ONCE_QUERY_OPERATIONS) {
  AuditLogSchema.pre(operation, { document: false, query: true }, () =>
    refuseToChangeAuditRow(operation),
  );
}
// `doc.updateOne()` and `doc.deleteOne()` are separate hooks from the query forms.
for (const operation of ["updateOne", "deleteOne"] as const) {
  AuditLogSchema.pre(operation, { document: true, query: false }, () =>
    refuseToChangeAuditRow(`document.${operation}`),
  );
}
AuditLogSchema.pre("bulkWrite", () => refuseToChangeAuditRow("bulkWrite"));
AuditLogSchema.pre("save", function () {
  if (!this.isNew) refuseToChangeAuditRow("save() on an existing row");
});

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
