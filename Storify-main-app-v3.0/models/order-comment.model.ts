import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * Staff comment on an order.
 *
 * Deliberately NOT an AuditLog row, even though both render in the same
 * Timeline card. Three reasons the two must stay in separate collections:
 *
 * 1. `audit_logs` carries a TTL index (see `AUDIT_LOG_RETENTION_DAYS`). Audit
 *    rows are allowed to expire; a merchant's own writing is not.
 * 2. The audit log's whole value is that nothing edits it. Comments need edit
 *    and delete — putting mutable human content in an immutable log means it
 *    is no longer an audit log.
 * 3. Comments are user-generated content subject to erasure/rectification
 *    requests. Audit records are retained on different legal grounds. One
 *    erasure against a merged collection breaks the tamper-evidence story.
 *
 * So: two stores, one view. `getOrderTimeline` merges them by `createdAt`.
 *
 * The comment's own history lives on the document — `editedAt` and a soft
 * `deletedAt` — rather than in extra audit rows, which would double-render in
 * the merged timeline. Nothing is ever hard-deleted.
 */
interface IOrderComment extends mongoose.Document {
  orderId: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId;
  /** Denormalized at write time so rendering the feed needs no populate. */
  authorName: string;
  authorEmail?: string;
  authorImage?: string;
  body: string;
  /**
   * The vendors the author was scoped to when they wrote this.
   *
   * Empty means store-authored. A vendor-scoped reader only sees comments that
   * intersect their own vendors — without this, a vendor's employee opening a
   * shared marketplace order would read the store's internal notes ("chargeback
   * risk, do not ship") sitting under a composer that promises "Only visible to
   * your team".
   */
  authorVendorIds: mongoose.Types.ObjectId[];
  /** Set on every edit; the UI shows an "edited" marker when present. */
  editedAt?: Date;
  /** Soft delete — null (or absent) means live. Rows are never removed. */
  deletedAt?: Date | null;
  deletedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OrderCommentSchema = new Schema<IOrderComment>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    authorEmail: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    authorImage: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    authorVendorIds: {
      type: [Schema.Types.ObjectId],
      ref: "Vendor",
      default: [],
    },
    editedAt: {
      type: Date,
    },
    // `null` rather than `undefined` so `{ deletedAt: null }` also matches rows
    // written before this field existed.
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Serves the only query this collection has: a single order's comments,
// newest first, merged into the timeline.
OrderCommentSchema.index({ orderId: 1, createdAt: -1 });

/**
 * Live comments only. Matches rows where `deletedAt` is null AND rows written
 * before the field existed, so it is safe on legacy data.
 */
export const NOT_DELETED_ORDER_COMMENT_FILTER = { deletedAt: null } as const;

/**
 * Restricts a vendor-scoped reader to comments written from within one of
 * their own vendors. Admins and platform-wide staff carry no vendor scope and
 * get `{}` — they see everything, including store-authored notes.
 *
 * `$in` deliberately does not match an empty or absent `authorVendorIds`, so
 * store-authored comments (and any row written before this field existed) stay
 * invisible to a vendor's staff.
 */
export function buildCommentAudienceFilter(vendorIds?: string[] | null) {
  if (!vendorIds?.length) return {};
  return { authorVendorIds: { $in: vendorIds } };
}

export const OrderComment =
  models.OrderComment ||
  model<IOrderComment>("OrderComment", OrderCommentSchema);
