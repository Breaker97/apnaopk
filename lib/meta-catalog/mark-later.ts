/**
 * `markProductsForCatalogSync` for the shared write paths — the product
 * save, an import, a sale or a stock edit (inventory, transfers, pre-orders,
 * plan limits). Loaded on
 * demand, so those modules do not pull the Meta catalog's models in with
 * them, and never throws — loading included: the write it follows has
 * already happened, and the hourly reconcile heals a lost mark. A no-op
 * unless live sync is on (lib/meta-catalog/sync-marks.ts).
 */
export async function markForMetaCatalog(
  productIds: Iterable<unknown>,
  options?: { delayMs?: number },
): Promise<void> {
  try {
    const { markProductsForCatalogSync } = await import("@/lib/meta-catalog/sync-marks");
    await markProductsForCatalogSync(productIds, options);
  } catch (error) {
    console.error("Failed to mark products for the Meta catalog:", error);
  }
}
