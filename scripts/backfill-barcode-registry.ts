import { connectDB, disconnectDB } from "@/lib/db";
import { Product } from "@/models/product.model";
import { BarcodeRegistry } from "@/models/barcode-registry.model";
import {
  buildBarcodeRegistryEntries,
  syncProductBarcodeRegistry,
} from "@/lib/products/barcode-registry";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await connectDB();
  const products = await Product.find({})
    .select("barcode barcodeFormat barcodeSource variants")
    .lean();
  const owners = new Map<string, string>();
  const conflicts: Array<{ value: string; first: string; second: string }> = [];

  for (const product of products) {
    const productId = String(product._id);
    for (const entry of buildBarcodeRegistryEntries(
      product as unknown as Record<string, unknown>,
    )) {
      const owner = entry.variantId
        ? `product ${productId}, variant ${entry.variantId}`
        : `product ${productId}`;
      const first = owners.get(entry.valueNormalized);
      if (first) {
        conflicts.push({ value: entry.valueNormalized, first, second: owner });
      } else {
        owners.set(entry.valueNormalized, owner);
      }
    }
  }

  if (conflicts.length > 0) {
    console.error("Duplicate barcodes must be resolved before backfill:");
    for (const conflict of conflicts) {
      console.error(
        `  ${conflict.value}: ${conflict.first} and ${conflict.second}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(
      `Dry run complete: ${owners.size} unique barcode values across ${products.length} products.`,
    );
    return;
  }

  await BarcodeRegistry.createIndexes();
  for (const product of products) {
    await syncProductBarcodeRegistry(
      String(product._id),
      product as unknown as Record<string, unknown>,
    );
  }
  console.log(
    `Backfilled ${owners.size} barcode registry entries across ${products.length} products.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
