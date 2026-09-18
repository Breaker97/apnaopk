import { Product, Settings } from "@/models";
import { LEDGER_ACCOUNT, LEDGER_BOOK } from "@/lib/finance/accounts";
import { postLedgerEntries, postingKey, type LedgerPosting } from "@/lib/finance/ledger";
import { getDefaultVendorIds } from "@/lib/finance/post-events";
import { quantizeToCurrency } from "@/lib/intl/money";
import { LEDGER_SOURCE_KIND } from "@/models/ledger-entry.model";

/**
 * Units rejected when a transfer arrives — crushed in the van, short-shipped,
 * lost — left the source at ship time and never landed anywhere, so the goods
 * they were are gone. On the store's own books that is inventory written off:
 * the asset shrinks and the loss lands in cost of goods, the retail convention
 * for shrinkage, at the unit cost the catalogue records.
 *
 * Only the store's own products post. A marketplace vendor's stock is the
 * vendor's asset and never sat in the store's inventory account, exactly as a
 * vendor's sale posts no cost of goods. A unit with no recorded cost posts
 * nothing rather than zero — as with a sale, an unknown cost is not a free one.
 */
export async function postTransferWriteOff(params: {
  transferId: unknown;
  transferNumber: string;
  /** The receipt's history entry id; one write-off per receipt, however often it replays. */
  receiptId: unknown;
  at: Date;
  lines: Array<{
    productId: string;
    variantId: string;
    rejected: number;
    label: string;
  }>;
}): Promise<number> {
  const rejected = params.lines.filter((line) => line.rejected > 0);
  if (rejected.length === 0) return 0;

  const [ownVendorIds, products, settings] = await Promise.all([
    getDefaultVendorIds(),
    Product.find({ _id: { $in: [...new Set(rejected.map((line) => line.productId))] } })
      .select("vendorId cost variants._id variants.cost")
      .lean<
        Array<{
          _id: unknown;
          vendorId?: unknown;
          cost?: number;
          variants?: Array<{ _id?: unknown; cost?: number }>;
        }>
      >(),
    Settings.findOne()
      .select("general.defaultCurrency")
      .lean<{ general?: { defaultCurrency?: string } } | null>(),
  ]);
  const currency = (settings?.general?.defaultCurrency || "USD").toUpperCase();
  const productById = new Map(products.map((product) => [String(product._id), product]));

  const postings: LedgerPosting[] = [];
  for (const line of rejected) {
    const product = productById.get(line.productId);
    if (!product || !ownVendorIds.has(String(product.vendorId))) continue;

    const variant = line.variantId
      ? (product.variants || []).find((entry) => String(entry._id) === line.variantId)
      : undefined;
    const unitCost = Number(line.variantId ? variant?.cost : product.cost);
    if (!Number.isFinite(unitCost) || unitCost <= 0) continue;

    postings.push({
      date: params.at,
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.COST_OF_GOODS,
      credit: LEDGER_ACCOUNT.INVENTORY,
      amount: quantizeToCurrency(unitCost * line.rejected, currency),
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.TRANSFER,
        id: String(params.transferId),
        ref: params.transferNumber,
      },
      vendorId: String(product.vendorId),
      key: postingKey(
        LEDGER_SOURCE_KIND.TRANSFER,
        params.transferId,
        "write-off",
        String(params.receiptId),
        line.productId,
        line.variantId || "product",
      ),
      note: `${line.rejected} × ${line.label} rejected on receipt of ${params.transferNumber}`,
    });
  }

  return postLedgerEntries(postings);
}
