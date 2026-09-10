import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const samplesDir = path.join(root, "docs", "samples");
const categoriesPath = path.join(samplesDir, "international-categories-12.csv");
const collectionsPath = path.join(samplesDir, "international-collections-16.csv");
const productsPath = path.join(samplesDir, "international-catalog-200.json");
const vendorCatalogDirectory = path.join(samplesDir, "vendor-catalogs");

const CATEGORY_HEADERS = [
  "id", "name", "slug", "description", "image", "icon", "parent", "parentId",
  "order", "isActive", "featured", "seoPageTitle", "seoMetaDescription", "seoTags",
];
const COLLECTION_HEADERS = [
  "id", "title", "slug", "description", "descriptionHtml", "imageUrl", "imageAlt",
  "collectionType", "status", "productIds", "products", "conditions", "conditionMatch",
  "sortOrder", "position", "onlineStore", "pointOfSale", "seoPageTitle", "seoMetaDescription",
];

const categories = [
  ["Electronics", "electronics", "Explore dependable technology for work, play, and connected everyday life.", "", 1, true, "Technology for modern routines", "Shop curated electronics and connected essentials.", "electronics,technology"],
  ["Fashion & Living", "fashion-living", "Discover practical style, comfortable living, and thoughtful daily essentials.", "", 2, true, "Fashion and living essentials", "Shop apparel, home, wellness, and digital essentials.", "fashion,living"],
  ["Mobile & Tablets", "mobile-tablets", "Portable devices and accessories for connected work, travel, and entertainment.", "Electronics", 10, false, "Mobile and tablet essentials", "Browse mobile devices and tablet-ready essentials.", "mobile,tablets"],
  ["Computing", "computing", "Flexible computing gear designed for productive desks, studios, and home offices.", "Electronics", 11, false, "Computing essentials", "Browse capable computing products for focused work.", "computing,technology"],
  ["Audio & Wearables", "audio-wearables", "Audio and wearable pieces for movement, listening, and daily routines.", "Electronics", 12, false, "Audio and wearable essentials", "Browse audio and wearable technology for everyday use.", "audio,wearables"],
  ["Cameras & Smart Home", "cameras-smart-home", "Capture ideas and simplify spaces with smart creative technology.", "Electronics", 13, false, "Cameras and smart home", "Browse cameras and smart home essentials.", "cameras,smart-home"],
  ["Apparel", "apparel", "Layerable apparel made for comfortable, versatile everyday dressing.", "Fashion & Living", 20, false, "Everyday apparel", "Browse apparel for comfortable daily wear.", "apparel,clothing"],
  ["Footwear & Bags", "footwear-bags", "Reliable footwear and bags for commutes, errands, and weekends away.", "Fashion & Living", 21, false, "Footwear and bags", "Browse practical footwear and bags.", "footwear,bags"],
  ["Home & Kitchen", "home-kitchen", "Useful home and kitchen pieces that make everyday tasks feel easier.", "Fashion & Living", 22, false, "Home and kitchen essentials", "Browse home and kitchen essentials for daily routines.", "home,kitchen"],
  ["Furniture & Decor", "furniture-decor", "Furniture and decor designed to bring considered function to your space.", "Fashion & Living", 23, false, "Furniture and decor", "Browse furniture and decor for intentional spaces.", "furniture,decor"],
  ["Beauty & Wellness", "beauty-wellness", "Wellness and beauty staples for simple, restorative care rituals.", "Fashion & Living", 24, false, "Beauty and wellness", "Browse beauty and wellness essentials.", "beauty,wellness"],
  ["Digital Downloads", "digital-downloads", "Instant digital tools and resources for creative, organized work.", "Fashion & Living", 25, false, "Digital downloads", "Browse instant digital resources and creative tools.", "digital,downloads"],
];

const families = [
  { category: "Mobile & Tablets", slug: "mobile-tablets", code: "MOB", prefix: "Atlas Mobile Pro", count: 20, physical: true, tag: "catalog-mobile-tablets", extras: ["tech", "premium", "giftable"], price: 299, priceStep: 18, compare: 70, cost: 180, costStep: 10, weight: 0.22, options: [["Color", [["Midnight", "#111827"], ["Silver", "#D1D5DB"]]], ["Storage", ["128 GB", "256 GB"]]] },
  { category: "Computing", slug: "computing", code: "CMP", prefix: "Axiom Workstation", count: 20, physical: true, tag: "catalog-computing", extras: ["tech", "premium"], price: 549, priceStep: 30, compare: 120, cost: 330, costStep: 18, weight: 1.45, options: [["Color", [["Graphite", "#374151"], ["Cloud", "#F3F4F6"]]], ["Configuration", ["Core", "Plus"]]] },
  { category: "Audio & Wearables", slug: "audio-wearables", code: "AUD", prefix: "Sonic Pulse", count: 20, physical: true, tag: "catalog-audio-wearables", extras: ["tech", "everyday", "giftable"], price: 69, priceStep: 11, compare: 35, cost: 32, costStep: 5, weight: 0.34, options: [["Color", [["Onyx", "#111111"], ["Stone", "#A8A29E"]]], ["Edition", ["Standard", "Travel"]]] },
  { category: "Cameras & Smart Home", slug: "cameras-smart-home", code: "CAM", prefix: "Lumen Capture", count: 18, physical: true, tag: "catalog-cameras-smart-home", extras: ["tech", "premium", "giftable"], price: 129, priceStep: 22, compare: 65, cost: 70, costStep: 12, weight: 0.68, options: [["Color", [["Carbon", "#1F2937"], ["Ivory", "#FAFAF9"]]], ["Kit", ["Essential", "Creator"]]] },
  { category: "Apparel", slug: "apparel", code: "APR", prefix: "Meridian Layer", count: 22, physical: true, tag: "catalog-apparel", extras: ["everyday", "giftable"], price: 39, priceStep: 7, compare: 20, cost: 16, costStep: 3, weight: 0.42, options: [["Color", [["Navy", "#1E3A5F"], ["Sand", "#D6C2A8"]]], ["Size", ["S", "M"]]] },
  { category: "Footwear & Bags", slug: "footwear-bags", code: "FTB", prefix: "Venture Step", count: 18, physical: true, tag: "catalog-footwear-bags", extras: ["everyday", "giftable"], price: 59, priceStep: 9, compare: 30, cost: 25, costStep: 4, weight: 0.76, options: [["Color", [["Black", "#111111"], ["Tan", "#B77945"]]], ["Size", ["Medium", "Large"]]] },
  { category: "Home & Kitchen", slug: "home-kitchen", code: "HMK", prefix: "Haven Everyday", count: 18, physical: true, tag: "catalog-home-kitchen", extras: ["everyday", "giftable"], price: 29, priceStep: 6, compare: 15, cost: 11, costStep: 2, weight: 0.88, options: [["Color", [["Sage", "#8A9A5B"], ["Cream", "#F5F1E8"]]], ["Capacity", ["Compact", "Family"]]] },
  { category: "Furniture & Decor", slug: "furniture-decor", code: "FUR", prefix: "Formline Studio", count: 14, physical: true, tag: "catalog-furniture-decor", extras: ["premium", "giftable"], price: 119, priceStep: 24, compare: 60, cost: 55, costStep: 12, weight: 6.5, options: [["Color", [["Walnut", "#6B4226"], ["Oak", "#C19A6B"]]], ["Finish", ["Matte", "Natural"]]] },
  { category: "Beauty & Wellness", slug: "beauty-wellness", code: "BEA", prefix: "Verde Ritual", count: 20, physical: true, tag: "catalog-beauty-wellness", extras: ["everyday", "giftable"], price: 19, priceStep: 5, compare: 10, cost: 7, costStep: 2, weight: 0.3, options: [["Scent", ["Citrus", "Botanical"]], ["Size", ["50 ml", "100 ml"]]] },
  { category: "Digital Downloads", slug: "digital-downloads", code: "DIG", prefix: "Creator Studio Pack", count: 30, physical: false, tag: "catalog-digital-downloads", extras: ["digital", "giftable", "tech"], price: 12, priceStep: 3, compare: 8, cost: 2, costStep: 0, options: [["License", ["Personal", "Commercial"]]] },
];

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function writeCsv(filePath, headers, rows) {
  fs.writeFileSync(filePath, `${[headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`);
}
function writeCatalog(filePath, catalogProducts) {
  fs.writeFileSync(filePath, `${JSON.stringify({ products: catalogProducts }, null, 2)}\n`);
}
function tagCondition(value) { return { field: "tag", operator: "contains", value }; }
function option([name, values]) {
  return {
    name,
    ...(name === "Color" ? { visual: "color" } : {}),
    values: values.map((value) => Array.isArray(value) ? { value: value[0], colorCode: value[1] } : value),
  };
}

function createProductGroups() {
  return families.map((family) => Array.from({ length: family.count }, (_, index) => {
    const sequence = String(index).padStart(2, "0");
    const price = family.price + index * family.priceStep;
    const product = {
      title: `${family.prefix} ${sequence}`,
      slug: `seed-200-${family.slug}-${sequence}`,
      sku: `S200-${family.code}-${sequence}`,
      description: `${family.prefix} ${sequence} is designed for ${family.physical ? "reliable daily use, with considered details for home, work, and gifting" : "creative work, with an immediate digital license for flexible projects"}.`,
      shortDescription: `${family.prefix} ${sequence} for practical everyday use.`,
      category: family.category,
      productType: family.category,
      price,
      comparePrice: price + family.compare,
      cost: family.cost + index * family.costStep,
      stock: family.physical ? 10 + (index % 20) : 0,
      status: "active",
      tags: ["seed-200", family.tag, ...family.extras],
      onlineStore: true,
      pointOfSale: false,
      featured: index % 10 === 0,
      isPhysicalProduct: family.physical,
      options: family.options.map(option),
    };
    return family.physical
      ? { ...product, weight: String(family.weight), weightUnit: "kg" }
      : { ...product, digitalDelivery: { downloadLimit: 3 } };
  }));
}

fs.mkdirSync(samplesDir, { recursive: true });
writeCsv(categoriesPath, CATEGORY_HEADERS, categories.map(([name, slug, description, parent, order, featured, seoPageTitle, seoMetaDescription, seoTags]) => ["", name, slug, description, "", "", parent, "", order, "true", String(featured), seoPageTitle, seoMetaDescription, seoTags]));

const categoryCollections = categories.slice(2).map(([title, slug]) => ({ title, slug, conditions: [tagCondition(`catalog-${slug}`)] }));
const crossCollections = [
  ["New In Store", "new-in-store", [tagCondition("seed-200")]], ["Tech Essentials", "tech-essentials", [tagCondition("tech")]],
  ["Everyday Essentials", "everyday-essentials", [tagCondition("everyday")]], ["Premium Picks", "premium-picks", [tagCondition("premium")]],
  ["Gifts Under $100", "gifts-under-100", [tagCondition("giftable"), { field: "price", operator: "less_than", value: 100 }]], ["Digital Finds", "digital-finds", [tagCondition("digital")]],
].map(([title, slug, conditions]) => ({ title, slug, conditions }));
writeCsv(collectionsPath, COLLECTION_HEADERS, [...categoryCollections, ...crossCollections].map((collection, index) => ["", collection.title, collection.slug, `Automatically curated ${collection.title} products.`, `<p>Automatically curated ${collection.title} products.</p>`, "", "", "automated", "active", "", "", JSON.stringify(collection.conditions), "all", "created-desc", index + 1, "true", "false", `${collection.title} collection`, `Shop the ${collection.title} collection.`]));

const productGroups = createProductGroups();
const products = productGroups.flat();
const adminProducts = productGroups.flatMap((group) => group.slice(0, 5));
const remainingProducts = productGroups.flatMap((group) => group.slice(5));
const vendorProducts = Array.from({ length: 10 }, () => []);

remainingProducts.forEach((product, index) => {
  vendorProducts[index % 10].push(product);
});

if (products.length !== 200 || adminProducts.length !== 50 || remainingProducts.length !== 150) {
  throw new Error("Vendor allocation must split 200 products into 50 admin and 150 vendor products.");
}
if (vendorProducts.some((productsForVendor) => productsForVendor.length !== 15)) {
  throw new Error("Each vendor allocation must contain exactly 15 products.");
}

fs.mkdirSync(vendorCatalogDirectory, { recursive: true });
writeCatalog(productsPath, products);
writeCatalog(path.join(vendorCatalogDirectory, "admin-catalog-50.json"), adminProducts);
vendorProducts.forEach((productsForVendor, index) => {
  writeCatalog(
    path.join(vendorCatalogDirectory, `vendor-${String(index + 1).padStart(2, "0")}-catalog-15.json`),
    productsForVendor,
  );
});
const physical = products.filter((product) => product.isPhysicalProduct).length;
const digital = products.length - physical;
const variants = products.reduce((total, product) => total + product.options.reduce((count, option) => count * option.values.length, 1), 0);
console.log(`categories: ${categories.length}`);
console.log(`collections: ${categoryCollections.length + crossCollections.length}`);
console.log(`physical-products: ${physical}`);
console.log(`digital-products: ${digital}`);
console.log(`generated-variants: ${variants}`);
console.log(`admin-products: ${adminProducts.length}`);
console.log(`vendor-catalogs: ${vendorProducts.length}`);
console.log(`products-per-vendor: ${vendorProducts[0].length}`);
