import { Category } from "@/models";
import { csvFileResponse, csvLine } from "@/lib/catalog/csv";

type ProductImportSampleFormat = "csv" | "json";
type ProductImportAudience = "admin" | "vendor";

/**
 * The columns a merchant fills in, in the order the sample lists them. The
 * import reads a few more (ids from an export, barcode format and source, the
 * admin's vendorId); the column guide in the import dialog covers those.
 */
const SAMPLE_COLUMNS = [
  "title",
  "slug",
  "sku",
  "barcode",
  "description",
  "shortDescription",
  "price",
  "comparePrice",
  "cost",
  "stock",
  "status",
  "category",
  "brand",
  "tags",
  "images",
  "onlineStore",
  "pointOfSale",
  "featured",
  "productType",
  "isPhysicalProduct",
  "inventoryTracked",
  "digitalDownloadLimit",
  "weight",
  "weightUnit",
  "countryOfOrigin",
  "hsCode",
] as const;

type SampleColumn = (typeof SAMPLE_COLUMNS)[number];

/** Columns a vendor's import ignores, so their sample leaves them out. */
const ADMIN_ONLY_COLUMNS = new Set<SampleColumn>(["featured"]);

const PLACEHOLDER_CATEGORY = "Your category";

/**
 * Up to `count` categories a product can be filed under — leaves, written the
 * way the importer reads them unambiguously: the path ("Women > Dresses") for a
 * nested one, the slug for a top-level one whose name another category shares,
 * the plain name otherwise — so the sample imports into this store as it
 * stands instead of failing on a category it never had.
 */
async function sampleCategories(count: number): Promise<string[]> {
  const categories = await Category.find({})
    .select("_id name slug parentId isActive order")
    .sort({ order: 1, name: 1 })
    .lean<
      Array<{
        _id: unknown;
        name?: string;
        slug?: string;
        parentId?: unknown;
        isActive?: boolean;
      }>
    >();

  const byId = new Map(categories.map((category) => [String(category._id), category]));
  const parents = new Set(
    categories.map((category) => (category.parentId ? String(category.parentId) : "")),
  );
  const nameCounts = new Map<string, number>();
  for (const category of categories) {
    const key = String(category.name ?? "").trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const labelOf = (category: (typeof categories)[number]) => {
    const name = String(category.name ?? "");
    if (!category.parentId) {
      return (nameCounts.get(name.trim().toLowerCase()) ?? 0) > 1
        ? String(category.slug ?? name)
        : name;
    }
    const names = [name];
    let parentId = String(category.parentId);
    while (parentId && names.length < 5) {
      const parent = byId.get(parentId);
      if (!parent) break;
      names.unshift(String(parent.name ?? ""));
      parentId = parent.parentId ? String(parent.parentId) : "";
    }
    return names.join(" > ");
  };

  const leaves = categories
    .filter((category) => category.isActive !== false && !parents.has(String(category._id)))
    .map(labelOf);
  if (leaves.length === 0) return Array(count).fill(PLACEHOLDER_CATEGORY);
  return Array.from({ length: count }, (_, index) => leaves[index % leaves.length]);
}

function sampleCsvRows(categories: string[]): Array<Partial<Record<SampleColumn, string>>> {
  return [
    {
      title: "Classic Cotton T-Shirt",
      slug: "classic-cotton-t-shirt",
      sku: "TSHIRT-CLASSIC-001",
      description:
        "<p>Soft, breathable 100% cotton tee with a relaxed fit. Machine washable.</p>",
      shortDescription: "Everyday cotton tee with a relaxed fit.",
      price: "24.99",
      comparePrice: "29.99",
      cost: "9.50",
      stock: "120",
      status: "draft",
      category: categories[0],
      tags: "cotton|basics|summer",
      images:
        "https://example.com/images/classic-tee-front.jpg|https://example.com/images/classic-tee-back.jpg",
      onlineStore: "true",
      pointOfSale: "true",
      featured: "false",
      productType: "T-Shirt",
      isPhysicalProduct: "true",
      inventoryTracked: "true",
      weight: "0.2",
      weightUnit: "kg",
      hsCode: "610910",
    },
    {
      title: "Stainless Steel Water Bottle",
      slug: "stainless-steel-water-bottle",
      sku: "BOTTLE-STEEL-750",
      description: "Keeps drinks cold for 24 hours and hot for 12. Holds 750 ml.",
      price: "18",
      stock: "60",
      status: "draft",
      category: categories[1],
      tags: "kitchen|outdoor",
      onlineStore: "true",
      pointOfSale: "false",
      isPhysicalProduct: "true",
      weight: "350",
      weightUnit: "g",
    },
    {
      title: "Monthly Budget Planner (PDF)",
      slug: "monthly-budget-planner-pdf",
      sku: "PLANNER-PDF-001",
      description:
        "A printable 12-month budget planner. Customers download it after paying.",
      price: "9",
      status: "draft",
      category: categories[2],
      tags: "digital|printable",
      onlineStore: "true",
      isPhysicalProduct: "false",
      digitalDownloadLimit: "3",
    },
  ];
}

function sampleCatalog(categories: string[]) {
  return {
    products: [
      {
        title: "Everyday Hoodie",
        slug: "everyday-hoodie",
        sku: "HOODIE-EVERYDAY",
        description: "<p>Midweight fleece hoodie with a brushed interior.</p>",
        category: categories[0],
        price: 49,
        comparePrice: 59,
        stock: 10,
        status: "draft",
        tags: ["hoodie", "outerwear"],
        images: ["https://example.com/images/everyday-hoodie.jpg"],
        isPhysicalProduct: true,
        weight: 0.6,
        weightUnit: "kg",
        options: [
          {
            name: "Color",
            visual: "color",
            values: [
              { value: "Black", colorCode: "#111827" },
              { value: "Sand", colorCode: "#D6C7A1" },
            ],
          },
          { name: "Size", values: ["S", "M", "L"] },
        ],
        variants: [
          {
            optionValues: { Color: "Black", Size: "L" },
            sku: "HOODIE-EVERYDAY-BLACK-L",
            price: 54,
            stock: 4,
          },
        ],
      },
      {
        title: "Brand Style Guide Template",
        slug: "brand-style-guide-template",
        sku: "TEMPLATE-BRAND-GUIDE",
        description: "<p>An editable brand guide template. Delivered as a download.</p>",
        category: categories[2],
        price: 19,
        status: "draft",
        tags: ["digital", "template"],
        isPhysicalProduct: false,
        digitalDelivery: { downloadLimit: 3 },
        options: [{ name: "License", values: ["Personal", "Commercial"] }],
        variants: [{ optionValues: { License: "Commercial" }, price: 49 }],
      },
    ],
  };
}

/** The sample file for the import dialog's "download sample" buttons. */
export async function productImportSampleResponse(
  format: ProductImportSampleFormat,
  audience: ProductImportAudience,
): Promise<Response> {
  const categories = await sampleCategories(3);

  if (format === "json") {
    return new Response(`${JSON.stringify(sampleCatalog(categories), null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="product-import-sample.json"',
        "Cache-Control": "no-store",
      },
    });
  }

  const columns = SAMPLE_COLUMNS.filter(
    (column) => audience === "admin" || !ADMIN_ONLY_COLUMNS.has(column),
  );
  return csvFileResponse("product-import-sample.csv", [
    columns.join(","),
    ...sampleCsvRows(categories).map((row) => csvLine(columns.map((column) => row[column] ?? ""))),
  ]);
}
