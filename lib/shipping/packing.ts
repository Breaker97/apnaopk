import { convertWeight, type ProductWeightUnit } from "@/lib/catalog/product-shipping";
import {
  FALLBACK_PARCEL,
  MINIMUM_PARCEL_WEIGHT,
  type DimensionUnit,
} from "@/lib/shipping/carrier-config";
import type { ICarrierPackagePreset } from "@/models/settings.model";
import type { CarrierParcel } from "@/lib/shipping/carriers/types";

/**
 * Turn a sub-order's items into the parcel a carrier will price.
 *
 * Pure and synchronous — no database, no `server-only` — so it is unit-testable
 * and the Send-to-courier dialog can run it client-side for a live preview of
 * which box will be used before anything is sent to a carrier.
 */

export interface PackableItem {
  quantity: number;
  unitWeight: number;
  weightUnit: ProductWeightUnit;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: DimensionUnit;
}

type PackStrategy = "preset_fit" | "preset_default" | "fallback_box";

type PackWarning =
  | "MISSING_WEIGHT"
  | "MISSING_DIMENSIONS"
  | "NO_PACKAGE_PRESET"
  | "OVERWEIGHT";

export interface PackResult {
  parcels: CarrierParcel[];
  boxId?: string;
  strategy: PackStrategy;
  warnings: PackWarning[];
}

const CM_PER_INCH = 2.54;

function toCentimetres(value: number, unit: DimensionUnit): number {
  return unit === "in" ? value * CM_PER_INCH : value;
}

function fromCentimetres(value: number, unit: DimensionUnit): number {
  return unit === "in" ? value / CM_PER_INCH : value;
}

function positive(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function volumeCm3(preset: ICarrierPackagePreset): number {
  const unit = preset.dimensionUnit || "cm";
  return (
    toCentimetres(preset.length, unit) *
    toCentimetres(preset.width, unit) *
    toCentimetres(preset.height, unit)
  );
}

/**
 * Whether `envelope` fits inside `preset` in any orientation.
 *
 * Both triples are sorted descending first, which makes rotation free: a box is
 * a box however you turn it, and comparing axis-by-axis in declaration order
 * would reject a 30×20×10 item from a 30×10×20 box for no reason.
 */
function fits(
  envelopeCm: [number, number, number],
  preset: ICarrierPackagePreset,
): boolean {
  const unit = preset.dimensionUnit || "cm";
  const box = [
    toCentimetres(preset.length, unit),
    toCentimetres(preset.width, unit),
    toCentimetres(preset.height, unit),
  ].sort((a, b) => b - a);
  const item = [...envelopeCm].sort((a, b) => b - a);
  return item.every((value, index) => value <= box[index]!);
}

/**
 * Pack one sub-order into a single parcel.
 *
 * Deliberately not a bin-packing solver. Splitting a consignment across boxes
 * changes what the merchant is charged and what the customer receives, and a
 * guess at that is worse than a carrier saying no — so an over-capacity
 * consignment is returned in the largest box with a warning and the carrier
 * gets to reject it honestly.
 */
export function packSubOrder(params: {
  items: PackableItem[];
  packages: ICarrierPackagePreset[];
  /** The store's weight unit; the parcel is expressed in it. */
  weightUnit: "kg" | "lb";
  minimumWeight?: number;
}): PackResult {
  const warnings: PackWarning[] = [];
  const weightUnit = params.weightUnit;
  const minimumWeight =
    params.minimumWeight ?? MINIMUM_PARCEL_WEIGHT[weightUnit];

  let contentsWeight = 0;
  let maxLength = 0;
  let maxWidth = 0;
  let stackedHeight = 0;
  let itemsWithDimensions = 0;

  for (const item of params.items) {
    const quantity = Math.max(0, Math.round(positive(item.quantity)) || 0);
    if (quantity === 0) continue;

    contentsWeight +=
      convertWeight(positive(item.unitWeight), item.weightUnit || "kg", weightUnit) *
      quantity;

    const unit = item.dimensionUnit || "cm";
    const length = positive(item.length);
    const width = positive(item.width);
    const height = positive(item.height);
    if (length && width && height) {
      itemsWithDimensions += 1;
      maxLength = Math.max(maxLength, toCentimetres(length, unit));
      maxWidth = Math.max(maxWidth, toCentimetres(width, unit));
      // One stacking axis: items pile up, they do not nest.
      stackedHeight += toCentimetres(height, unit) * quantity;
    }
  }

  if (itemsWithDimensions < params.items.length) {
    warnings.push("MISSING_DIMENSIONS");
  }

  // Carriers reject a zero-weight parcel outright, and a merchant who never
  // filled the weight in is common enough that failing the shipment over it
  // would be the wrong trade.
  if (contentsWeight <= 0) {
    warnings.push("MISSING_WEIGHT");
    contentsWeight = minimumWeight;
  }

  const active = params.packages.filter((preset) => preset?.active !== false);

  if (active.length === 0) {
    warnings.push("NO_PACKAGE_PRESET");
    return {
      parcels: [
        {
          ...FALLBACK_PARCEL,
          weight: round(contentsWeight),
          weightUnit,
        },
      ],
      strategy: "fallback_box",
      warnings,
    };
  }

  const envelope: [number, number, number] | null =
    itemsWithDimensions > 0 ? [maxLength, maxWidth, stackedHeight] : null;

  const bySize = [...active].sort((a, b) => volumeCm3(a) - volumeCm3(b));

  let chosen: ICarrierPackagePreset | undefined;
  let strategy: PackStrategy = "preset_default";

  if (envelope) {
    // Smallest box that actually holds it: a carrier prices by volume, so the
    // tightest fit is the cheapest honest answer.
    chosen = bySize.find(
      (preset) =>
        fits(envelope, preset) &&
        (!preset.maxWeight || contentsWeight <= preset.maxWeight),
    );
    if (chosen) strategy = "preset_fit";
  }

  if (!chosen) {
    chosen =
      active.find((preset) => preset.isDefault) ?? bySize[bySize.length - 1]!;
    strategy = "preset_default";
  }

  if (chosen.maxWeight && contentsWeight > chosen.maxWeight) {
    const largest = bySize[bySize.length - 1]!;
    // Everything is over capacity, so send the biggest box and let the carrier
    // refuse it rather than silently inventing a split.
    chosen = largest;
    warnings.push("OVERWEIGHT");
  }

  const boxUnit = chosen.dimensionUnit || "cm";
  const tare = convertWeight(
    positive(chosen.emptyWeight),
    chosen.weightUnit || "kg",
    weightUnit,
  );

  return {
    parcels: [
      {
        length: round(fromCentimetres(toCentimetres(chosen.length, boxUnit), boxUnit)),
        width: round(fromCentimetres(toCentimetres(chosen.width, boxUnit), boxUnit)),
        height: round(fromCentimetres(toCentimetres(chosen.height, boxUnit), boxUnit)),
        dimensionUnit: boxUnit,
        weight: round(contentsWeight + tare),
        weightUnit,
      },
    ],
    boxId: chosen.id,
    strategy,
    warnings,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
