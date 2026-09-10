/**
 * A merchant's physical place: a warehouse, a shop floor, a collection counter.
 *
 * ONE entity for every kind, distinguished by what it can do rather than by
 * which table it lives in. A warehouse stocks inventory and admits nobody; a
 * shop front does both; a market stall might take collections while holding no
 * counted stock at all. Pickup branches used to live separately, embedded on
 * the vendor document, which meant the same physical address was described
 * twice and the two descriptions drifted — and neither knew about the other, so
 * "collect from where the stock is" was not expressible.
 *
 * `pickupEnabled` is the flag that answers the question a warehouse must answer
 * "no" to: **may the public walk in here?** Deriving that from stock instead
 * would publish every fulfilment centre as a collection point.
 *
 * Locations are **per vendor**, not platform-wide. A marketplace vendor keeps
 * their own stock in their own places, and one vendor must never see, rename,
 * or draw stock from another's. In single-vendor mode the admin acts as the
 * default vendor (see `lib/multi-vendor.ts`), so the same model serves both
 * modes with no branching.
 *
 * `vendorId` is deliberately **not** `required`: documents written before the
 * field existed must keep loading, and a legacy row must survive an ordinary
 * `.save()` (a rename) rather than failing validation. Reads tolerate the gap —
 * see `lib/inventory-location-scope.ts` — and `scripts/backfill-location-vendor.ts`
 * assigns an owner to every existing row.
 */

import { mongoose } from "@/lib/db";
import type { IInventoryLocation } from "@/types";

const { Schema, models, model } = mongoose;

// A dev server that compiled this file before `vendorId` existed keeps the old
// compiled schema in `models`, so a scoped query would silently strip the
// filter. Drop the stale registration instead. Same guard as
// models/pickup-slot.model.ts.
const existingLocationModel = models.InventoryLocation as
  | typeof models.InventoryLocation
  | undefined;
if (
  existingLocationModel &&
  (!existingLocationModel.schema.path("vendorId") ||
    !existingLocationModel.schema.path("pickupEnabled") ||
    !existingLocationModel.schema.path("fulfillsOnlineOrders") ||
    !existingLocationModel.schema.path("sellsAtCounter") ||
    !existingLocationModel.schema.path("mapsUrl") ||
    // A field this file has REMOVED. A stale schema still carrying it would
    // keep stamping `stocksInventory: true` onto every location created in
    // that dev session, seeding rows the migration has already been run to
    // clear.
    existingLocationModel.schema.path("stocksInventory"))
) {
  delete models.InventoryLocation;
}

/** Opening hours, shown at checkout as guidance. Not enforced. */
const LocationOpeningHoursSchema = new Schema(
  {
    weekday: { type: Number, min: 0, max: 6 },
    enabled: { type: Boolean, default: false },
    start: { type: String, maxlength: 5 },
    end: { type: String, maxlength: 5 },
  },
  { _id: false },
);

const InventoryLocationSchema = new Schema<IInventoryLocation>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      index: true,
    },
    name: {
      type: String,
      required: [true, "Location name is required"],
      trim: true,
      maxlength: [100, "Location name cannot exceed 100 characters"],
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // ---------------------------------------------------------- capabilities
    /**
     * The public may collect orders here. Off by default, because the safe
     * answer for a place nobody has said anything about is "no" — the opposite
     * default would publish a merchant's warehouse the moment they created it.
     */
    pickupEnabled: {
      type: Boolean,
      default: false,
    },
    /**
     * Delivery orders may be dispatched from here.
     *
     * Defaults **true**, unlike `pickupEnabled`. The two defaults answer
     * different questions: publishing a warehouse to the public is a disclosure
     * a merchant must opt into, whereas drawing stock down for a posted order
     * is what every location already did before this flag existed — the
     * decrement simply took from wherever the units were. Defaulting false
     * would leave a store with no eligible branch and quietly send every order
     * down the legacy path.
     */
    fulfillsOnlineOrders: {
      type: Boolean,
      default: true,
    },
    /**
     * A register may stand here.
     *
     * Defaults **true**, like `fulfillsOnlineOrders` and unlike
     * `pickupEnabled`, because it is not a disclosure: the list it gates is only
     * ever shown to the merchant's own staff, and every register that worked
     * before this field existed has to keep working. Defaulting false would
     * offer a cashier no counter at all and send the whole estate back to
     * aggregate stock. `lib/locations/counter-location.ts` owns the reading, so
     * the badge on the locations screen and the POS picker cannot disagree.
     */
    sellsAtCounter: {
      type: Boolean,
      default: true,
    },
    /**
     * Dispatch order. Lower goes first; ties fall back to `isDefault`, then
     * name, so a merchant who never touches this still gets a sensible answer.
     */
    fulfillmentPriority: {
      type: Number,
      default: 0,
    },

    // ------------------------------------------------- pickup-facing details
    /**
     * The neighbourhood, shown before an order exists. The exact `address` is
     * withheld until there is an order to collect — see
     * `pickupAvailabilityLocationDetails`.
     */
    pickupArea: {
      type: String,
      trim: true,
      maxlength: [160, "Pickup area cannot exceed 160 characters"],
    },
    /** Shown after confirmation: which door, who to ask for. */
    instructions: {
      type: String,
      trim: true,
      maxlength: [1000, "Instructions cannot exceed 1000 characters"],
    },
    weeklyHours: {
      type: [LocationOpeningHoursSchema],
      default: [],
    },

    /**
     * The map link the merchant pasted, kept verbatim.
     *
     * `geo` alone would be enough to answer "where is this", but not enough to
     * survive an edit: a merchant fixing a typo in the address sends no map
     * link, and without this the point would fall back to the vendor's
     * registered address and the hand-placed pin would vanish. It is also what
     * the form shows back, so the field is not mysteriously blank on reopen.
     */
    mapsUrl: {
      type: String,
      trim: true,
      maxlength: [500, "Map link cannot exceed 500 characters"],
    },

    /**
     * Where this place actually is, in the GeoJSON shape a 2dsphere index needs.
     *
     * Derived, never hand-authored: build it with `vendorGeoPoint()` so the
     * [lng, lat] axis order is decided in exactly one place. Getting it
     * backwards does not error — it silently moves a Dhaka branch to a point
     * off Antarctica, and the branch simply stops appearing in radius searches.
     *
     * This is what "near me" must measure from. The vendor's own `address.geo`
     * is a payouts/KYC address and answers a different question.
     */
    geo: {
      type: new Schema(
        {
          type: { type: String, enum: ["Point"] },
          coordinates: { type: [Number] },
        },
        { _id: false },
      ),
    },
  },
  {
    timestamps: true,
  }
);

/**
 * One default per vendor.
 *
 * Scoped to `vendorId`, because the platform-wide version of this hook meant
 * any vendor saving a location silently un-defaulted every other vendor's. It
 * also only fires when `isDefault` actually changed — otherwise a save that
 * merely renames a location, or flips `isActive`, would re-run the sweep.
 */
InventoryLocationSchema.pre("save", async function () {
  if (!this.isDefault || !this.isModified("isDefault")) return;

  await (this.constructor as typeof InventoryLocation).updateMany(
    { vendorId: this.vendorId ?? null, _id: { $ne: this._id } },
    { isDefault: false }
  );
});

// Every list query is "this vendor's active locations", so the owner leads the
// key. `autoIndex` builds this on boot; the pre-existing single-field indexes
// are left in place because Mongoose never drops what it no longer declares.
InventoryLocationSchema.index({ vendorId: 1, isActive: 1 });
InventoryLocationSchema.index({ vendorId: 1, isDefault: 1 });
// "Which branches can this cart be collected from" — the checkout question.
InventoryLocationSchema.index({ vendorId: 1, pickupEnabled: 1, isActive: 1 });
// "Which counters may this cashier stand at" — asked once per POS page load.
InventoryLocationSchema.index({ vendorId: 1, sellsAtCounter: 1, isActive: 1 });
// "Which branch does a posted order leave from" — the dispatch question, asked
// on every order creation, so the sort key rides in the index.
InventoryLocationSchema.index({
  vendorId: 1,
  fulfillsOnlineOrders: 1,
  isActive: 1,
  fulfillmentPriority: 1,
});
// Sparse, because most locations will never be geocoded and a 2dsphere index
// rejects a document whose indexed field is present but malformed — sparse
// keeps those rows out of the index instead of failing their save.
InventoryLocationSchema.index({ geo: "2dsphere" }, { sparse: true });

export const InventoryLocation =
  models.InventoryLocation ||
  model<IInventoryLocation>("InventoryLocation", InventoryLocationSchema);
