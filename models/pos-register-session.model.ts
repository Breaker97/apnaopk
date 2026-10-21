import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * A register session: one till's drawer from opening to closing.
 *
 * The drawer is physical, so a session belongs to a DEVICE (`terminalId`, the
 * random id each register keeps — see lib/pos/offline-receipt.ts) within one
 * merchant (`vendorId`, the scope the register sells for). It follows the
 * device if it moves between counters; `locationId` records where it was
 * opened, for the report.
 *
 * What the drawer should hold is not stored while the session is open — it is
 * worked out from the tenders tagged with the session (`Order.posTenders[].
 * sessionId`) and the cash events here (lib/pos/register-session.ts). At
 * closing that answer is written down with the count: the Z report, kept as it
 * was even if a sale is later refunded.
 */

export const POS_CASH_EVENT_KINDS = [
  /** Notes put in the drawer: more change, a float top-up. */
  "in",
  /** Notes taken out: banked, a paid-out. */
  "out",
  /** Cash handed back on a return at the till. */
  "refund",
  /**
   * The drawer opened with no money moving ("No sale"), and why. Amount 0;
   * kept so an opened drawer always has a who, when and why.
   */
  "no_sale",
] as const;
export type POSCashEventKind = (typeof POS_CASH_EVENT_KINDS)[number];

export interface IPosCashEvent {
  kind: POSCashEventKind;
  amount: number;
  reason?: string;
  by: string;
  at: Date;
  /** The return or order a refund event paid out for. */
  orderId?: mongoose.Types.ObjectId;
  returnNumber?: string;
  /** One request, one event: a retried request adds nothing. */
  requestId: string;
}

export interface IPosTenderTotals {
  cash: number;
  card: number;
  bank: number;
  manual: number;
  store_credit: number;
}

export interface IPosRegisterSession {
  _id: mongoose.Types.ObjectId;
  number: string;
  vendorId?: string;
  terminalId: string;
  locationId?: string;
  currency: string;
  status: "open" | "closed";
  openedBy: string;
  openedAt: Date;
  openingFloat: number;
  openRequestId: string;
  cashEvents: IPosCashEvent[];
  closedBy?: string;
  closedAt?: Date;
  /** Written at closing: the Z report. */
  closing?: {
    expected: IPosTenderTotals;
    counted: { cash: number };
    variance: number;
    salesCount: number;
    grossSales: number;
    refunds: number;
    cashIn: number;
    cashOut: number;
    note?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const TOTALS = {
  cash: { type: Number, default: 0 },
  card: { type: Number, default: 0 },
  bank: { type: Number, default: 0 },
  manual: { type: Number, default: 0 },
  store_credit: { type: Number, default: 0 },
};

const PosRegisterSessionSchema = new Schema<IPosRegisterSession>(
  {
    number: { type: String, required: true, trim: true },
    vendorId: { type: String, trim: true },
    terminalId: { type: String, required: true, trim: true, maxlength: 40 },
    locationId: { type: String, trim: true },
    currency: { type: String, required: true, uppercase: true, trim: true },
    status: { type: String, enum: ["open", "closed"], required: true, default: "open" },
    openedBy: { type: String, required: true },
    openedAt: { type: Date, required: true },
    openingFloat: { type: Number, required: true, min: 0, default: 0 },
    openRequestId: { type: String, required: true, trim: true },
    cashEvents: {
      type: [
        new Schema<IPosCashEvent>(
          {
            kind: { type: String, enum: POS_CASH_EVENT_KINDS, required: true },
            amount: { type: Number, required: true, min: 0 },
            reason: { type: String, trim: true, maxlength: 300 },
            by: { type: String, required: true },
            at: { type: Date, required: true },
            orderId: { type: Schema.Types.ObjectId, ref: "Order" },
            returnNumber: { type: String, trim: true },
            requestId: { type: String, required: true, trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    closedBy: { type: String },
    closedAt: { type: Date },
    closing: {
      type: new Schema(
        {
          expected: { type: new Schema(TOTALS, { _id: false }) },
          counted: { type: new Schema({ cash: { type: Number, min: 0 } }, { _id: false }) },
          variance: { type: Number },
          salesCount: { type: Number },
          grossSales: { type: Number },
          refunds: { type: Number },
          cashIn: { type: Number },
          cashOut: { type: Number },
          note: { type: String, trim: true, maxlength: 1000 },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);

// One open drawer per device per merchant.
PosRegisterSessionSchema.index(
  { vendorId: 1, terminalId: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);
// Opening is idempotent on its request key.
PosRegisterSessionSchema.index({ openRequestId: 1 }, { unique: true });
PosRegisterSessionSchema.index({ vendorId: 1, openedAt: -1 });
PosRegisterSessionSchema.index({ number: 1 });

export const PosRegisterSession =
  models.PosRegisterSession ||
  model<IPosRegisterSession>("PosRegisterSession", PosRegisterSessionSchema);
