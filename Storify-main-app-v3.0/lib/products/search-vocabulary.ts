import { PRODUCT_STATUS } from "@/config/app.config";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { connectDB } from "@/lib/db";
import { collectIndexWords } from "@/lib/products/search";
import {
  buildSearchVocabulary,
  type SearchVocabulary,
} from "@/lib/products/search-typo";
import { Brand, Category, Product } from "@/models";

/**
 * The catalogue's vocabulary for typo correction — every word the live
 * products are indexed under, with how many products carry it, plus the
 * words of the category and brand names.
 *
 * Held in process memory rather than in the data cache: it is only read on
 * the rare search that matched nothing, it can run to megabytes on a large
 * catalogue (past the data cache's per-entry limit), and it is cheap to
 * rebuild. Deliberately NOT refreshed on every product save: a new product
 * is findable by its exact words the moment it is saved, through the index;
 * only correcting a misspelling TOWARD its words waits for the next rebuild.
 */

const TTL_MS = 10 * 60_000;

let current: { vocabulary: SearchVocabulary; builtAt: number } | null = null;
let inFlight: Promise<SearchVocabulary> | null = null;

async function buildVocabulary(): Promise<SearchVocabulary> {
  await connectDB();
  const visibility = await getStorefrontProductConstraint();

  const [termRows, categories, brands] = await Promise.all([
    // One row per distinct term. `$unwind` + `$group` rather than
    // `distinct`, which returns a single document and would hit the 16 MB
    // limit long before a large catalogue runs out of words.
    Product.aggregate<{ _id: string; n: number }>([
      { $match: { status: PRODUCT_STATUS.ACTIVE, ...visibility } },
      { $project: { _id: 0, t: "$search.terms" } },
      { $unwind: "$t" },
      { $group: { _id: "$t", n: { $sum: 1 } } },
    ]).allowDiskUse(true),
    Category.find({ isActive: true }).select("name").lean<{ name?: string }[]>(),
    Brand.find(STOREFRONT_BRAND_FILTER).select("name").lean<{ name?: string }[]>(),
  ]);

  const nameRows = [...categories, ...brands].flatMap((entity) =>
    collectIndexWords(entity.name).map((term) => ({ term, count: 1 })),
  );

  return buildSearchVocabulary([
    ...termRows.map((row) => ({ term: row._id, count: row.n })),
    ...nameRows,
  ]);
}

/**
 * The vocabulary, rebuilt at most every ten minutes. A stale one is served
 * while its replacement builds, so only the very first correction in a
 * process waits for the aggregation; concurrent callers share one build.
 */
export async function getSearchVocabulary(): Promise<SearchVocabulary> {
  const now = Date.now();
  if (current && now - current.builtAt < TTL_MS) return current.vocabulary;

  if (!inFlight) {
    inFlight = buildVocabulary()
      .then((vocabulary) => {
        current = { vocabulary, builtAt: Date.now() };
        return vocabulary;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  if (current) {
    // Stale-while-revalidate: a failed rebuild keeps the old words.
    inFlight.catch((error) => {
      console.warn("[product-search] vocabulary rebuild failed", error);
    });
    return current.vocabulary;
  }
  return inFlight;
}
