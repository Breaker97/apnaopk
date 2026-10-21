import { Product } from "@/models";
import { csvFileResponse, csvLine } from "@/lib/catalog/csv";

/**
 * The columns a merchant fills in, in the order the sample lists them. The
 * import reads a few more (ids and `productIds` from an export,
 * `descriptionHtml`, `position`); the column guide in the import dialog
 * covers those.
 */
export const COLLECTION_SAMPLE_COLUMNS = [
  "title",
  "slug",
  "description",
  "imageUrl",
  "imageAlt",
  "collectionType",
  "status",
  "products",
  "conditions",
  "conditionMatch",
  "sortOrder",
  "onlineStore",
  "pointOfSale",
  "seoPageTitle",
  "seoMetaDescription",
] as const;

type SampleColumn = (typeof COLLECTION_SAMPLE_COLUMNS)[number];

/**
 * Up to `count` of this store's own product slugs, so the manual example
 * imports as it stands instead of naming products the store never had.
 */
async function sampleProductSlugs(count: number): Promise<string[]> {
  const products = await Product.find({ slug: { $exists: true, $ne: "" } })
    .select("slug")
    .sort({ createdAt: -1 })
    .limit(count)
    .lean<Array<{ slug?: string }>>();
  return products.map((product) => String(product.slug)).filter(Boolean);
}

function sampleRows(productSlugs: string[]): Array<Partial<Record<SampleColumn, string>>> {
  return [
    {
      title: "Summer Essentials",
      slug: "summer-essentials",
      description: "Light pieces for the warm months.",
      imageUrl: "https://example.com/images/summer-essentials.jpg",
      imageAlt: "Summer essentials",
      collectionType: "manual",
      status: "draft",
      products: productSlugs.join("|"),
      sortOrder: "manual",
      onlineStore: "true",
      pointOfSale: "false",
      seoPageTitle: "Summer Essentials",
      seoMetaDescription: "Shop light pieces for the warm months.",
    },
    {
      title: "Under 50",
      slug: "under-50",
      description: "Every product that costs less than 50.",
      collectionType: "automated",
      status: "draft",
      conditions: JSON.stringify([{ field: "price", operator: "less_than", value: "50" }]),
      conditionMatch: "all",
      sortOrder: "price-asc",
      onlineStore: "true",
      pointOfSale: "false",
    },
  ];
}

/** The sample import file, filled with this store's own products. */
export async function collectionImportSampleResponse() {
  const rows = sampleRows(await sampleProductSlugs(3));
  return csvFileResponse("collection-import-sample.csv", [
    COLLECTION_SAMPLE_COLUMNS.join(","),
    ...rows.map((row) =>
      csvLine(COLLECTION_SAMPLE_COLUMNS.map((column) => row[column] ?? "")),
    ),
  ]);
}
