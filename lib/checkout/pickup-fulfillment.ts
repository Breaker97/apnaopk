type PickupLifecycleAction = "ready" | "collected";
type PickupLifecycleStatus = "scheduled" | "ready" | "collected";

type PickupLifecycleUpdate = {
  pickupStatus: PickupLifecycleStatus;
  subOrderStatus: "processing" | "delivered";
  readyAt?: Date;
  collectedAt?: Date;
  deliveredAt?: Date;
};

/**
 * Defines the only allowed vendor-managed pickup transitions. Pickup stays a
 * fulfillment state, while the surrounding sub-order remains compatible with
 * the existing processing/delivered reporting workflow.
 */
export function resolvePickupLifecycleUpdate(input: {
  action: PickupLifecycleAction;
  pickupStatus: PickupLifecycleStatus;
  orderStatus: string;
  now?: Date;
}): PickupLifecycleUpdate {
  const now = input.now || new Date();

  if (input.action === "ready") {
    if (input.pickupStatus !== "scheduled") {
      throw new Error("This pickup has already been marked ready");
    }
    if (!["pending", "processing"].includes(input.orderStatus)) {
      throw new Error("Only an active order can be marked ready for pickup");
    }
    return {
      pickupStatus: "ready",
      subOrderStatus: "processing",
      readyAt: now,
    };
  }

  if (input.pickupStatus !== "ready") {
    throw new Error("This pickup must be marked ready first");
  }
  if (input.orderStatus !== "processing") {
    throw new Error("Only a processing pickup can be marked collected");
  }
  return {
    pickupStatus: "collected",
    subOrderStatus: "delivered",
    collectedAt: now,
    deliveredAt: now,
  };
}
