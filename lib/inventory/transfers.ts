import { Product } from "@/models";

export type TransferLifecycleStatus =
  | "draft"
  | "ready_to_ship"
  | "in_transit"
  | "completed"
  | "cancelled";

type TransferLine = {
  productId: string;
  variantId: string;
  quantity: number;
};

const ALLOWED_TRANSITIONS: Record<
  TransferLifecycleStatus,
  TransferLifecycleStatus[]
> = {
  draft: ["ready_to_ship", "cancelled"],
  ready_to_ship: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionTransferStatus(
  currentStatus: TransferLifecycleStatus,
  nextStatus: TransferLifecycleStatus,
) {
  return ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export async function generateTransferNumber() {
  const seed = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 90 + 10);
  return `TR-${seed}${random}`;
}

/**
 * Ensure the destination location has an entry on the variant so the atomic
 * move below can target it with an arrayFilter. Idempotent: matches only
 * while the entry is missing, pushes a zero-quantity entry (no stock change).
 */
async function ensureVariantLocationEntry(params: {
  productId: string;
  variantId: string;
  locationId: string;
}): Promise<void> {
  await Product.updateOne(
    {
      _id: params.productId,
      variants: {
        $elemMatch: {
          _id: params.variantId,
          "locationInventory.locationId": { $ne: params.locationId },
        },
      },
    },
    {
      $push: {
        "variants.$[v].locationInventory": {
          locationId: params.locationId,
          quantity: 0,
        },
      },
    },
    { arrayFilters: [{ "v._id": params.variantId }] },
  );
}

/**
 * Move one line's quantity between two location entries in a single guarded
 * update. The filter requires BOTH entries to exist and the source to hold at
 * least `quantity`, so a concurrent sale/adjustment that drains the source
 * makes this match nothing instead of going negative — and the two $incs are
 * net-zero, so variant.stock / product stock aggregates are untouched.
 * Returns false when the guard did not match (insufficient source stock, or
 * product/variant/entry missing).
 */
async function moveVariantLocationQuantity(params: {
  productId: string;
  variantId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
}): Promise<boolean> {
  const result = await Product.updateOne(
    {
      _id: params.productId,
      variants: {
        $elemMatch: {
          _id: params.variantId,
          locationInventory: {
            $all: [
              {
                $elemMatch: {
                  locationId: params.fromLocationId,
                  quantity: { $gte: params.quantity },
                },
              },
              { $elemMatch: { locationId: params.toLocationId } },
            ],
          },
        },
      },
    },
    {
      $inc: {
        "variants.$[v].locationInventory.$[src].quantity": -params.quantity,
        "variants.$[v].locationInventory.$[dst].quantity": params.quantity,
      },
    },
    {
      arrayFilters: [
        { "v._id": params.variantId },
        {
          "src.locationId": params.fromLocationId,
          "src.quantity": { $gte: params.quantity },
        },
        { "dst.locationId": params.toLocationId },
      ],
    },
  );
  return result.matchedCount === 1;
}

/**
 * Apply a completed transfer's stock movement, line by line, with guarded
 * atomic updates instead of the previous findById → mutate → save() — a
 * document save() $set the whole locationInventory array from a stale
 * in-memory copy, silently clobbering any sale that landed between the read
 * and the write, and a mid-list failure left earlier lines applied with no
 * way to retry safely (the retry re-applied them).
 *
 * On failure, already-applied lines are moved back (best-effort, logged) so
 * the caller's status revert leaves the transfer cleanly retryable.
 */
export async function applyTransferInventory(params: {
  fromLocationId: string;
  toLocationId: string;
  items: TransferLine[];
}) {
  const lines = params.items.filter((item) => Number(item.quantity) > 0);
  const applied: TransferLine[] = [];

  const rollbackApplied = async () => {
    for (const line of applied.reverse()) {
      const reversed = await moveVariantLocationQuantity({
        productId: line.productId,
        variantId: line.variantId,
        fromLocationId: params.toLocationId,
        toLocationId: params.fromLocationId,
        quantity: line.quantity,
      }).catch((err) => {
        console.error("Transfer rollback failed for line:", line, err);
        return false;
      });
      if (!reversed) {
        console.error(
          "Transfer rollback could not restore line (destination stock changed concurrently):",
          line,
        );
      }
    }
  };

  for (const line of lines) {
    try {
      await ensureVariantLocationEntry({
        productId: line.productId,
        variantId: line.variantId,
        locationId: params.toLocationId,
      });
      const moved = await moveVariantLocationQuantity({
        productId: line.productId,
        variantId: line.variantId,
        fromLocationId: params.fromLocationId,
        toLocationId: params.toLocationId,
        quantity: line.quantity,
      });
      if (!moved) {
        await rollbackApplied();
        throw new Error(
          "Insufficient source location stock for one or more transfer items",
        );
      }
      applied.push(line);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("Insufficient source location stock")
      ) {
        throw err;
      }
      await rollbackApplied();
      throw err;
    }
  }
}
