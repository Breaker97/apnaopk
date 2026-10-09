import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * A business's own note about a customer, written from the business app
 * (lib/customers/business-customers.ts).
 *
 * Not `CustomerProfile.notes`: that is one free text the store's team edits on
 * the customer's page, with no author or time, and a seller must never read
 * it. A note here belongs to the business that wrote it (`businessScope`):
 * the store's team share the store's, a seller and their staff the seller's,
 * and neither ever sees the other's. It is about the customer, never part of
 * their account: writing one changes nothing a customer or another seller
 * sees.
 *
 * `customerKey` is who it is about, as the customer service names them:
 * `user:<userId>` for a shopper account, `email:<address>` for a guest (their
 * checkout email, lowercased). A guest who later proves the address on an
 * account keeps their notes: an account's notes are read under both keys.
 *
 * Kept as written: no editing, no deleting.
 */
export interface ICustomerNote extends mongoose.Document {
  /** `platform`, or the seller's vendor id. */
  businessScope: string;
  customerKey: string;
  body: string;
  authorId: mongoose.Types.ObjectId;
  /** Denormalized at write time: the note reads as it was signed. */
  authorName: string;
  /** `admin`, `staff` or `vendor`, as the author's account was then. */
  authorRole?: string;
  /**
   * The `Idempotency-Key` the note was sent with: a retry whose stored answer
   * has expired, or two that race, still write one note.
   */
  clientKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The longest note, as the contract says (CUSTOMER_NOTE_MAX_LENGTH). */
export const CUSTOMER_NOTE_BODY_MAX = 2000;

const CustomerNoteSchema = new Schema<ICustomerNote>(
  {
    businessScope: { type: String, required: true, trim: true, maxlength: 64 },
    customerKey: { type: String, required: true, trim: true, maxlength: 400 },
    body: { type: String, required: true, trim: true, maxlength: CUSTOMER_NOTE_BODY_MAX },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true, trim: true, maxlength: 120 },
    authorRole: { type: String, enum: ["admin", "staff", "vendor"] },
    clientKey: { type: String, trim: true, maxlength: 128 },
  },
  { timestamps: true },
);

// The only read: one business's notes about one customer, newest first.
CustomerNoteSchema.index({ businessScope: 1, customerKey: 1, createdAt: -1, _id: -1 });
// One note per tap, whatever the retries.
CustomerNoteSchema.index(
  { authorId: 1, clientKey: 1 },
  { unique: true, partialFilterExpression: { clientKey: { $type: "string" } } },
);

export const CustomerNote: mongoose.Model<ICustomerNote> =
  models.CustomerNote || model<ICustomerNote>("CustomerNote", CustomerNoteSchema);
