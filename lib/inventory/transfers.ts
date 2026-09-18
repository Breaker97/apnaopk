import { mongoose } from "@/lib/db";
import { InventoryLocation, Product, Transfer } from "@/models";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { isAdmin } from "@/lib/access/rbac";
import { revalidateProductStock } from "@/lib/cache-invalidation";
import { stockMovementChangesAvailability } from "@/lib/inventory/inventory";
import { postTransferWriteOff } from "@/lib/finance/transfer-postings";
import {
  allowedLocationIds,
  locationOwnerFilter,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import {
  TransferReceiptError,
  hasTransferReceipts,
  isTransferLockStale,
  planTransferReceipt,
  remainingTransferQuantity,
  transferAccess,
  type TransferAccess,
  type TransferEventType,
  type TransferLifecycleStatus,
  type TransferReceiptInput,
} from "@/lib/inventory/transfer-rules";

type SessionUser = {
  id: string;
  role?: string | null;
  roles?: (string | null | undefined)[] | null;
  name?: string | null;
  email?: string | null;
};

export type TransferItemRecord = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
  receivedQuantity?: number;
  rejectedQuantity?: number;
};

export type TransferRecord = {
  _id: unknown;
  transferNumber: string;
  status: TransferLifecycleStatus;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  items: TransferItemRecord[];
  note?: string;
  reference?: string;
  createdBy?: string;
  shippedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  stockMovementPending?: boolean;
  stockMovementStartedAt?: Date;
  events?: Array<Record<string, unknown>>;
  createdAt?: Date;
  updatedAt?: Date;
};

type StockLine = {
  productId: string;
  variantId: string;
  quantity: number;
  label: string;
};

export async function generateTransferNumber() {
  const seed = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 90 + 10);
  return `TR-${seed}${random}`;
}

// ---------------------------------------------------------------------------
// Who may see and act on which transfer
// ---------------------------------------------------------------------------

/**
 * The locations a caller may act on for transfers, or `null` for a platform
 * admin, who may act on all of them.
 *
 * A transfer has no owner of its own: it belongs to whoever holds its two
 * locations. Deriving access from the locations — rather than stamping a vendor
 * on the transfer — keeps transfers created before scoping existed covered too.
 */
export async function resolveTransferLocationAccess(
  user: SessionUser,
): Promise<Set<string> | null> {
  if (isAdmin(user as Parameters<typeof isAdmin>[0])) return null;
  const scope = await resolveLocationScope(user, "read");
  return allowedLocationIds(scope);
}

/** The `Transfer` filter matching every transfer a caller may see. */
export function transferVisibilityFilter(
  allowed: ReadonlySet<string> | null,
): Record<string, unknown> {
  if (allowed === null) return {};
  const ids = [...allowed];
  return {
    $or: [{ fromLocationId: { $in: ids } }, { toLocationId: { $in: ids } }],
  };
}

/**
 * Load a transfer the caller may see. A transfer outside their locations is
 * reported as missing, not forbidden, so its existence does not leak.
 */
export async function loadTransferForCaller(
  id: string,
  user: SessionUser,
): Promise<{ transfer: TransferRecord; access: TransferAccess }> {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Transfer");

  const [transfer, allowed] = await Promise.all([
    Transfer.findById(id).lean<TransferRecord>(),
    resolveTransferLocationAccess(user),
  ]);
  if (!transfer) throw new NotFoundError("Transfer");

  const access = transferAccess(transfer, allowed);
  if (!access.canView) throw new NotFoundError("Transfer");

  return { transfer, access };
}

/**
 * Both ends of a new or edited transfer, which must be two different active
 * locations the caller's store owns. An unscoped destination would be a way to
 * push stock into another merchant's warehouse — or, in reverse, to drain it.
 */
export async function requireTransferLocations(
  user: SessionUser,
  fromLocationId: string,
  toLocationId: string,
) {
  if (!fromLocationId || !toLocationId) {
    throw new ValidationError("From and To locations are required");
  }
  if (fromLocationId === toLocationId) {
    throw new ValidationError("Source and destination must be different");
  }
  if (
    !mongoose.isValidObjectId(fromLocationId) ||
    !mongoose.isValidObjectId(toLocationId)
  ) {
    throw new ValidationError("One or more selected locations are invalid");
  }

  const scope = await resolveLocationScope(user, "write");
  const [fromLocation, toLocation] = await Promise.all([
    InventoryLocation.findOne(
      locationOwnerFilter(scope, { _id: fromLocationId, isActive: true }),
    )
      .select("name")
      .lean<{ name: string }>(),
    InventoryLocation.findOne(
      locationOwnerFilter(scope, { _id: toLocationId, isActive: true }),
    )
      .select("name")
      .lean<{ name: string }>(),
  ]);

  if (!fromLocation || !toLocation) {
    throw new ValidationError("One or more selected locations are invalid");
  }

  return {
    fromLocation,
    toLocation,
    // Whose products may ride on the transfer. An admin is not limited; anyone
    // else only moves their own store's goods, even between their own shelves.
    productOwnerIds: isAdmin(user as Parameters<typeof isAdmin>[0])
      ? null
      : scope.readVendorIds,
  };
}

// ---------------------------------------------------------------------------
// Transfer lines
// ---------------------------------------------------------------------------

type LocationRow = { locationId: string; quantity: number };

type LeanVariant = {
  _id?: unknown;
  name?: string;
  sku?: string;
  locationInventory?: LocationRow[];
};

type LeanProduct = {
  _id: unknown;
  title?: string;
  name?: string;
  sku?: string;
  vendorId?: unknown;
  locationInventory?: LocationRow[];
  variants?: LeanVariant[];
};

function sourceQuantity(
  holder: { locationInventory?: LocationRow[] },
  locationId: string,
) {
  const entry = (holder.locationInventory || []).find(
    (row) => String(row.locationId) === locationId,
  );
  return typeof entry?.quantity === "number" ? entry.quantity : null;
}

function lineLabel(line: { productTitle?: string; variantTitle?: string }) {
  const product = line.productTitle || "Item";
  return line.variantTitle && line.variantTitle !== "Default"
    ? `${product} (${line.variantTitle})`
    : product;
}

/**
 * Turn submitted lines into transfer items: one line per variant (an empty
 * `variantId` names a product without variants, whose stock sits on the product
 * itself), whole positive quantities, titles and SKU read from the catalogue
 * rather than trusted from the client, and every quantity covered by the source
 * location as it stands now.
 *
 * `productOwnerIds` limits which stores' products may be named; `null` allows
 * any (an admin, or a re-check of lines already validated on the way in).
 */
export async function resolveTransferItems(
  fromLocationId: string,
  rawItems: unknown[],
  productOwnerIds: string[] | null = null,
): Promise<TransferItemRecord[]> {
  const merged = new Map<
    string,
    { productId: string; variantId: string; quantity: number }
  >();
  for (const raw of rawItems) {
    const row = (raw || {}) as Record<string, unknown>;
    const productId = String(row.productId || "").trim();
    const variantId = String(row.variantId || "").trim();
    const quantity = Math.trunc(Number(row.quantity) || 0);
    if (!productId || quantity <= 0) continue;
    if (!mongoose.isValidObjectId(productId)) {
      throw new ValidationError("Selected product no longer exists");
    }

    const key = `${productId}:${variantId}`;
    const current = merged.get(key);
    merged.set(key, {
      productId,
      variantId,
      quantity: (current?.quantity || 0) + quantity,
    });
  }

  if (merged.size === 0) {
    throw new ValidationError("At least one transfer item is required");
  }

  const lines = [...merged.values()];
  const products = await Product.find({
    _id: { $in: [...new Set(lines.map((line) => line.productId))] },
  })
    .select(
      "title name sku vendorId locationInventory variants._id variants.name variants.sku variants.locationInventory",
    )
    .lean<LeanProduct[]>();
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  return lines.map((line) => {
    const product = productById.get(line.productId);
    if (
      !product ||
      (productOwnerIds !== null &&
        !productOwnerIds.includes(String(product.vendorId)))
    ) {
      throw new ValidationError("Selected product no longer exists");
    }

    const hasVariants = (product.variants || []).length > 0;
    let holder: { locationInventory?: LocationRow[] };
    let variantTitle = "";
    let sku = product.sku || "";
    if (line.variantId) {
      const variant = (product.variants || []).find(
        (entry) => String(entry._id) === line.variantId,
      );
      if (!variant) {
        throw new ValidationError("Selected variant no longer exists");
      }
      holder = variant;
      variantTitle = variant.name || "Default";
      sku = variant.sku || "";
    } else if (hasVariants) {
      // Once a product has variants its own location rows are read by nothing
      // (see buildProductAggregateUpdate), so a line must name the variant.
      throw new ValidationError(
        `${product.title || product.name || "This product"} has variants — choose one`,
      );
    } else {
      holder = product;
    }

    const item: TransferItemRecord = {
      productId: line.productId,
      variantId: line.variantId,
      productTitle: product.title || product.name || "Untitled",
      variantTitle,
      sku,
      quantity: line.quantity,
      receivedQuantity: 0,
      rejectedQuantity: 0,
    };

    const available = sourceQuantity(holder, fromLocationId) ?? 0;
    if (available < line.quantity) {
      throw new ValidationError(
        `Only ${available} of ${lineLabel(item)} available at the source location`,
      );
    }

    return item;
  });
}

/**
 * How many units of each line the source location holds right now, keyed
 * `productId:variantId` — shown on a transfer that has not shipped yet, so a
 * shortfall is visible before shipping refuses it.
 */
export async function readSourceAvailability(
  fromLocationId: string,
  items: Array<{ productId: string; variantId: string }>,
): Promise<Map<string, number>> {
  const ids = [...new Set(items.map((item) => String(item.productId)))].filter(
    (id) => mongoose.isValidObjectId(id),
  );
  const products = await Product.find({ _id: { $in: ids } })
    .select("locationInventory variants._id variants.locationInventory")
    .lean<LeanProduct[]>();

  const available = new Map<string, number>();
  for (const product of products) {
    if (!(product.variants || []).length) {
      available.set(
        `${String(product._id)}:`,
        Math.max(0, sourceQuantity(product, fromLocationId) ?? 0),
      );
    }
    for (const variant of product.variants || []) {
      available.set(
        `${String(product._id)}:${String(variant._id)}`,
        Math.max(0, sourceQuantity(variant, fromLocationId) ?? 0),
      );
    }
  }
  return available;
}

// ---------------------------------------------------------------------------
// Stock movement
// ---------------------------------------------------------------------------

/**
 * Take units out of one location. The filter requires the location to hold at
 * least `quantity`, so a sale that drained it meanwhile makes this match
 * nothing rather than go negative. The variant's and product's stock drop with
 * it: units on a truck are not sellable anywhere.
 */
async function takeFromLocation(
  locationId: string,
  line: StockLine,
): Promise<boolean> {
  if (!line.variantId) {
    const result = await Product.updateOne(
      {
        _id: line.productId,
        locationInventory: {
          $elemMatch: { locationId, quantity: { $gte: line.quantity } },
        },
      },
      {
        $inc: {
          "locationInventory.$[li].quantity": -line.quantity,
          stock: -line.quantity,
        },
      },
      {
        arrayFilters: [
          { "li.locationId": locationId, "li.quantity": { $gte: line.quantity } },
        ],
      },
    );
    return result.matchedCount === 1;
  }

  const result = await Product.updateOne(
    {
      _id: line.productId,
      variants: {
        $elemMatch: {
          _id: line.variantId,
          locationInventory: {
            $elemMatch: { locationId, quantity: { $gte: line.quantity } },
          },
        },
      },
    },
    {
      $inc: {
        "variants.$[v].locationInventory.$[li].quantity": -line.quantity,
        "variants.$[v].stock": -line.quantity,
        "variants.$[v].inventory.quantity": -line.quantity,
        stock: -line.quantity,
      },
    },
    {
      arrayFilters: [
        { "v._id": line.variantId },
        { "li.locationId": locationId, "li.quantity": { $gte: line.quantity } },
      ],
    },
  );
  return result.matchedCount === 1;
}

/**
 * Add units at one location, creating the variant's entry there first if it
 * has none. Fails only when the product or variant no longer exists.
 */
async function putAtLocation(
  locationId: string,
  line: StockLine,
): Promise<boolean> {
  if (!line.variantId) {
    // Refused once the product has gained variants: its own rows no longer
    // count, so units landed there would vanish from every total.
    const noVariants = { $or: [{ variants: { $size: 0 } }, { variants: { $exists: false } }] };
    await Product.updateOne(
      {
        _id: line.productId,
        ...noVariants,
        "locationInventory.locationId": { $ne: locationId },
      },
      { $push: { locationInventory: { locationId, quantity: 0 } } },
    );
    const result = await Product.updateOne(
      {
        _id: line.productId,
        ...noVariants,
        "locationInventory.locationId": locationId,
      },
      {
        $inc: {
          "locationInventory.$[li].quantity": line.quantity,
          stock: line.quantity,
        },
      },
      { arrayFilters: [{ "li.locationId": locationId }] },
    );
    return result.matchedCount === 1;
  }

  // Idempotent: matches only while the entry is missing.
  await Product.updateOne(
    {
      _id: line.productId,
      variants: {
        $elemMatch: {
          _id: line.variantId,
          "locationInventory.locationId": { $ne: locationId },
        },
      },
    },
    {
      $push: {
        "variants.$[v].locationInventory": { locationId, quantity: 0 },
      },
    },
    { arrayFilters: [{ "v._id": line.variantId }] },
  );

  const result = await Product.updateOne(
    {
      _id: line.productId,
      variants: {
        $elemMatch: {
          _id: line.variantId,
          "locationInventory.locationId": locationId,
        },
      },
    },
    {
      $inc: {
        "variants.$[v].locationInventory.$[li].quantity": line.quantity,
        "variants.$[v].stock": line.quantity,
        "variants.$[v].inventory.quantity": line.quantity,
        stock: line.quantity,
      },
    },
    {
      arrayFilters: [
        { "v._id": line.variantId },
        { "li.locationId": locationId },
      ],
    },
  );
  return result.matchedCount === 1;
}

/**
 * Run one stock step per line. If any line fails, the lines already moved are
 * put back (best-effort, logged) before the error is thrown, so the caller can
 * leave the transfer untouched and retryable.
 */
async function moveLines(
  lines: StockLine[],
  step: (line: StockLine) => Promise<boolean>,
  undo: (line: StockLine) => Promise<boolean>,
  failure: (line: StockLine) => string,
  /** -1 when the step takes units, +1 when it adds them. */
  direction: 1 | -1,
) {
  const done: StockLine[] = [];

  const rollback = async () => {
    for (const line of done.reverse()) {
      const undone = await undo(line).catch((err) => {
        console.error("Transfer stock rollback failed for line:", line, err);
        return false;
      });
      if (!undone) {
        console.error(
          "Transfer stock rollback could not restore line (stock changed concurrently):",
          line,
        );
      }
    }
  };

  for (const line of lines) {
    let moved: boolean;
    try {
      moved = await step(line);
    } catch (err) {
      await rollback();
      throw err;
    }
    if (!moved) {
      await rollback();
      throw new ValidationError(failure(line));
    }
    done.push(line);
  }

  await refreshStorefrontStock(lines, direction);
}

/**
 * Expire the storefront's cached copies of the moved products. Best-effort: the
 * stock has already moved, and a cache miss must not report that as a failure.
 */
async function refreshStorefrontStock(lines: StockLine[], direction: 1 | -1) {
  if (lines.length === 0) return;
  try {
    const docs = await Product.find({
      _id: { $in: [...new Set(lines.map((line) => line.productId))] },
    })
      .select(
        "slug name stock vendorId shipping.isPhysicalProduct inventory variants._id variants.stock",
      )
      .lean<Array<{ slug?: string; _id: unknown }>>();
    revalidateProductStock({
      slugs: docs.map((doc) => doc.slug),
      availabilityChanged: stockMovementChangesAvailability(
        lines,
        docs,
        direction,
      ),
    });
  } catch (err) {
    console.error("Failed to refresh storefront stock after a transfer:", err);
  }
}

function takeLines(transfer: TransferRecord, lines: StockLine[]) {
  return moveLines(
    lines,
    (line) => takeFromLocation(transfer.fromLocationId, line),
    (line) => putAtLocation(transfer.fromLocationId, line),
    (line) =>
      `Not enough stock of ${line.label} at ${transfer.fromLocationName} to ship ${line.quantity}`,
    -1,
  );
}

function putLines(
  locationId: string,
  lines: StockLine[],
  failure: (line: StockLine) => string,
) {
  return moveLines(
    lines,
    (line) => putAtLocation(locationId, line),
    (line) => takeFromLocation(locationId, line),
    failure,
    1,
  );
}

function stockLine(item: TransferItemRecord, quantity: number): StockLine {
  return {
    productId: String(item.productId),
    variantId: String(item.variantId || ""),
    quantity,
    label: lineLabel(item),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type TransferActor = { id: string; name?: string };

export function transferActor(user: SessionUser): TransferActor {
  return {
    id: String(user.id),
    name: user.name || user.email || undefined,
  };
}

function transferEvent(
  type: TransferEventType,
  actor: TransferActor,
  extra: { note?: string; lines?: TransferReceiptInput[] } = {},
) {
  return {
    // Minted here rather than left to the push, so a receipt's id is known
    // before it is written — the write-off it posts is keyed on it.
    _id: new mongoose.Types.ObjectId(),
    type,
    at: new Date(),
    actorId: actor.id,
    actorName: actor.name,
    ...(extra.note ? { note: extra.note } : {}),
    ...(extra.lines ? { lines: extra.lines } : {}),
  };
}

const CHANGED_MESSAGE =
  "This transfer changed while you were working on it. Reload and try again.";

/**
 * Take the transfer's stock lock, provided it is still in `status`. Returns the
 * transfer as it stands under the lock — the only copy safe to plan a stock
 * movement from.
 */
async function lockTransfer(
  id: unknown,
  status: TransferLifecycleStatus,
  extraFilter: Record<string, unknown> = {},
): Promise<TransferRecord> {
  const locked = await Transfer.findOneAndUpdate(
    {
      _id: id,
      status,
      stockMovementPending: { $ne: true },
      ...extraFilter,
    },
    { $set: { stockMovementPending: true, stockMovementStartedAt: new Date() } },
    { returnDocument: "after" },
  ).lean<TransferRecord>();
  if (!locked) throw new ConflictError(CHANGED_MESSAGE);
  return locked;
}

async function releaseTransfer(
  id: unknown,
  update: { $set?: Record<string, unknown>; $push?: Record<string, unknown> } = {},
) {
  await Transfer.updateOne(
    { _id: id },
    {
      ...update,
      $unset: { stockMovementPending: "", stockMovementStartedAt: "" },
    },
  );
}

/** Release the lock after a failed move, then rethrow the failure. */
async function releaseAfterFailure(id: unknown, error: unknown): Promise<never> {
  await releaseTransfer(id).catch((err) =>
    console.error("Failed to release transfer stock lock:", err),
  );
  throw error;
}

/** A status change that moves no stock. */
async function setPlainStatus(
  transfer: TransferRecord,
  from: TransferLifecycleStatus,
  to: TransferLifecycleStatus,
  event: ReturnType<typeof transferEvent>,
) {
  const result = await Transfer.updateOne(
    { _id: transfer._id, status: from, stockMovementPending: { $ne: true } },
    {
      $set: {
        status: to,
        ...(to === "cancelled" ? { cancelledAt: new Date() } : {}),
      },
      $push: { events: event },
    },
  );
  if (result.matchedCount !== 1) throw new ConflictError(CHANGED_MESSAGE);
}

/** Draft → ready to ship. Re-checks the source still covers every line. */
export async function markTransferReady(
  transfer: TransferRecord,
  actor: TransferActor,
) {
  await resolveTransferItems(transfer.fromLocationId, transfer.items);
  await setPlainStatus(
    transfer,
    "draft",
    "ready_to_ship",
    transferEvent("ready_to_ship", actor),
  );
}

export async function returnTransferToDraft(
  transfer: TransferRecord,
  actor: TransferActor,
) {
  await setPlainStatus(
    transfer,
    "ready_to_ship",
    "draft",
    transferEvent("returned_to_draft", actor),
  );
}

/** Ready to ship → in transit. The units leave the source location now. */
export async function shipTransfer(
  transfer: TransferRecord,
  actor: TransferActor,
) {
  const locked = await lockTransfer(transfer._id, "ready_to_ship");
  try {
    await takeLines(
      locked,
      locked.items.map((item) => stockLine(item, Number(item.quantity))),
    );
  } catch (error) {
    await releaseAfterFailure(locked._id, error);
  }

  await releaseTransfer(locked._id, {
    $set: { status: "in_transit", shippedAt: new Date() },
    $push: { events: transferEvent("shipped", actor) },
  });
}

/**
 * Cancel a transfer. Before shipping nothing has moved; in transit, the units
 * go back to the source — which is why it is refused once anything has been
 * received, when some units have already landed at the destination.
 */
export async function cancelTransfer(
  transfer: TransferRecord,
  actor: TransferActor,
) {
  const event = transferEvent("cancelled", actor);

  if (transfer.status !== "in_transit") {
    await setPlainStatus(transfer, transfer.status, "cancelled", event);
    return;
  }

  if (hasTransferReceipts(transfer.items)) {
    throw new ValidationError(
      "Items on this transfer have already been received. Receive or reject the rest instead of cancelling.",
    );
  }

  const locked = await lockTransfer(transfer._id, "in_transit", {
    items: {
      $not: {
        $elemMatch: {
          $or: [
            { receivedQuantity: { $gt: 0 } },
            { rejectedQuantity: { $gt: 0 } },
          ],
        },
      },
    },
  });

  // A transfer shipped before stock moved at ship time never took its units
  // out of the source, so there is nothing to put back.
  if (locked.shippedAt) {
    try {
      await putLines(
        locked.fromLocationId,
        locked.items.map((item) => stockLine(item, Number(item.quantity))),
        (line) =>
          `${line.label} no longer exists, so its units cannot be returned to ${locked.fromLocationName}`,
      );
    } catch (error) {
      await releaseAfterFailure(locked._id, error);
    }
  }

  await releaseTransfer(locked._id, {
    $set: { status: "cancelled", cancelledAt: new Date() },
    $push: { events: event },
  });
}

/**
 * Record units arriving at the destination. Accepted units are added there;
 * rejected ones are only recorded. Completes the transfer once nothing is
 * outstanding.
 */
export async function receiveTransfer(
  transfer: TransferRecord,
  input: TransferReceiptInput[],
  note: string,
  actor: TransferActor,
) {
  const locked = await lockTransfer(transfer._id, "in_transit");

  let plan: ReturnType<typeof planTransferReceipt>;
  try {
    plan = planTransferReceipt(
      locked.items.map((item) => ({
        productId: String(item.productId),
        variantId: String(item.variantId || ""),
        quantity: Number(item.quantity) || 0,
        receivedQuantity: Number(item.receivedQuantity) || 0,
        rejectedQuantity: Number(item.rejectedQuantity) || 0,
      })),
      input,
    );
  } catch (error) {
    return releaseAfterFailure(
      locked._id,
      error instanceof TransferReceiptError
        ? new ValidationError(error.message)
        : error,
    );
  }

  const itemByKey = new Map(
    locked.items.map((item) => [
      `${item.productId}:${item.variantId || ""}`,
      item,
    ]),
  );
  const label = (productId: string, variantId: string, quantity: number) =>
    stockLine(itemByKey.get(`${productId}:${variantId}`)!, quantity);

  // Shipped before stock moved at ship time: take the units out of the source
  // now, as shipping would have, so receiving never conjures stock from nothing.
  const takeAtSource = !locked.shippedAt;

  try {
    if (takeAtSource) {
      await takeLines(
        locked,
        locked.items
          .map((item) => stockLine(item, remainingTransferQuantity(item)))
          .filter((line) => line.quantity > 0),
      );
    }
    try {
      await putLines(
        locked.toLocationId,
        plan.accepted.map((line) =>
          label(line.productId, line.variantId, line.quantity),
        ),
        (line) =>
          `${line.label} no longer exists, so it cannot be received. Reject these units instead.`,
      );
    } catch (error) {
      if (takeAtSource) {
        await putLines(
          locked.fromLocationId,
          locked.items
            .map((item) => stockLine(item, remainingTransferQuantity(item)))
            .filter((line) => line.quantity > 0),
          () => "rollback",
        ).catch((err) =>
          console.error("Failed to return legacy transfer stock to source:", err),
        );
      }
      throw error;
    }
  } catch (error) {
    await releaseAfterFailure(locked._id, error);
  }

  const now = new Date();
  const receipt = transferEvent("received", actor, { note, lines: plan.lines });
  const events = [receipt];
  if (plan.completes) events.push(transferEvent("completed", actor));

  await releaseTransfer(locked._id, {
    $set: {
      items: locked.items.map((item, index) => ({
        ...item,
        receivedQuantity: plan.items[index].receivedQuantity,
        rejectedQuantity: plan.items[index].rejectedQuantity,
      })),
      ...(takeAtSource ? { shippedAt: now } : {}),
      ...(plan.completes ? { status: "completed", completedAt: now } : {}),
    },
    $push: { events: { $each: events } },
  });

  // Best-effort and idempotent (keyed on the receipt): the stock has moved and
  // the receipt is recorded; a ledger hiccup must not report that as a failure.
  await postTransferWriteOff({
    transferId: locked._id,
    transferNumber: locked.transferNumber,
    receiptId: receipt._id,
    at: now,
    lines: plan.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      rejected: line.rejected,
      label: lineLabel(itemByKey.get(`${line.productId}:${line.variantId}`) || {}),
    })),
  }).catch((err) =>
    console.error("Failed to post transfer write-off to the ledger:", err),
  );

  return { completed: plan.completes };
}

/**
 * Clear a stock lock left behind by a movement that died part-way. Refused while
 * the lock is fresh — that is a movement still running. Moves no stock: whoever
 * releases it is expected to have checked the counts at both locations, which
 * is what the history entry records.
 */
export async function releaseStuckTransferLock(
  transfer: TransferRecord,
  actor: TransferActor,
) {
  if (!transfer.stockMovementPending) {
    throw new ValidationError("This transfer is not waiting on a stock movement");
  }
  if (!isTransferLockStale(transfer.stockMovementStartedAt)) {
    throw new ValidationError(
      "Stock is still being moved for this transfer. Wait a few minutes before releasing it.",
    );
  }

  const result = await Transfer.updateOne(
    {
      _id: transfer._id,
      stockMovementPending: true,
      ...(transfer.stockMovementStartedAt
        ? { stockMovementStartedAt: transfer.stockMovementStartedAt }
        : { stockMovementStartedAt: { $exists: false } }),
    },
    {
      $unset: { stockMovementPending: "", stockMovementStartedAt: "" },
      $push: { events: transferEvent("stock_lock_released", actor) },
    },
  );
  if (result.matchedCount !== 1) throw new ConflictError(CHANGED_MESSAGE);
}

/** Edit a draft: its locations, lines, reference, or note. */
export async function updateDraftTransfer(
  transfer: TransferRecord,
  user: SessionUser,
  changes: {
    fromLocationId?: string;
    toLocationId?: string;
    note?: string;
    reference?: string;
    items?: unknown[];
  },
) {
  if (transfer.status !== "draft") {
    throw new ValidationError("Only draft transfers can be edited");
  }

  const set: Record<string, unknown> = {};
  const fromLocationId = changes.fromLocationId ?? transfer.fromLocationId;
  const toLocationId = changes.toLocationId ?? transfer.toLocationId;

  if (
    fromLocationId !== transfer.fromLocationId ||
    toLocationId !== transfer.toLocationId
  ) {
    const { fromLocation, toLocation } = await requireTransferLocations(
      user,
      fromLocationId,
      toLocationId,
    );
    Object.assign(set, {
      fromLocationId,
      fromLocationName: fromLocation.name,
      toLocationId,
      toLocationName: toLocation.name,
    });
  }

  // Lines are re-checked whenever the source changes too, not only when they
  // are resubmitted: the old quantities say nothing about the new location.
  if (Array.isArray(changes.items) || set.fromLocationId) {
    set.items = await resolveTransferItems(
      fromLocationId,
      Array.isArray(changes.items) ? changes.items : transfer.items,
      isAdmin(user as Parameters<typeof isAdmin>[0])
        ? null
        : (await resolveLocationScope(user, "write")).readVendorIds,
    );
  }
  if (typeof changes.note === "string") set.note = changes.note.trim();
  if (typeof changes.reference === "string") {
    set.reference = changes.reference.trim();
  }

  const result = await Transfer.updateOne(
    { _id: transfer._id, status: "draft", stockMovementPending: { $ne: true } },
    { $set: set, $push: { events: transferEvent("updated", transferActor(user)) } },
  );
  if (result.matchedCount !== 1) throw new ConflictError(CHANGED_MESSAGE);
}

export function createdTransferEvent(user: SessionUser) {
  return transferEvent("created", transferActor(user));
}
