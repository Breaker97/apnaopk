import { mongoose } from "@/lib/db";
import type { Model } from "mongoose";

const { Schema, models, model } = mongoose;

/**
 * A shopper waiting for a pre-order spot to open.
 *
 * A pre-order with a limit stops selling the moment its reservations reach it,
 * and until this a shopper who arrived one minute late was simply turned away —
 * with no way to hear when a cancellation, an expiry or a raised limit freed a
 * place. This is the list they join instead.
 *
 * One row per shopper per product (or variant): joining twice is the same wait,
 * not two. `notifiedAt` is the claim — a row is written to once, by the one run
 * that sets it — so two releases landing together cannot email the same person
 * twice. First come, first told, by `createdAt`.
 *
 * A notification is an invitation, not a reservation. The spot goes to whoever
 * checks out first; see `lib/orders/preorder-waitlist.ts` for why that is the
 * choice, and how an invitation nobody takes up still reaches the next person.
 */
interface IPreorderWaitlist {
  productId: mongoose.Types.ObjectId;
  /** Absent for a product whose pre-order is set on the product itself. */
  variantId?: mongoose.Types.ObjectId | null;
  email: string;
  /** Set when a signed-in shopper joined, so the invitation reaches their inbox. */
  userId?: mongoose.Types.ObjectId | null;
  locale?: string;
  /** When they were told a spot opened. Null while still waiting. */
  notifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PreorderWaitlistSchema = new Schema<IPreorderWaitlist>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: { type: Schema.Types.ObjectId, default: null },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    locale: { type: String, trim: true, maxlength: 10 },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Joining twice is the same wait. A null variant is the product-level list.
PreorderWaitlistSchema.index(
  { productId: 1, variantId: 1, email: 1 },
  { unique: true },
);
// The one query every run makes: who on this list is still waiting, oldest first.
PreorderWaitlistSchema.index({
  productId: 1,
  variantId: 1,
  notifiedAt: 1,
  createdAt: 1,
});

export const PreorderWaitlist = ((models.PreorderWaitlist as
  | Model<IPreorderWaitlist>
  | undefined) ??
  model<IPreorderWaitlist>(
    "PreorderWaitlist",
    PreorderWaitlistSchema,
  )) as Model<IPreorderWaitlist>;
