import { isValidObjectId } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";

/**
 * The page address (`slug`) of each of these products, from one query however
 * many there are. For a line that keeps only a product's id (an order's, a
 * return's): the slug is what opens the product in the app.
 *
 * A product that no longer exists is not in the map; neither is one without a
 * slug. Ids that are not ids are ignored.
 */
export async function productSlugsOf(ids: Iterable<unknown>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].map((id) => String(id ?? "")).filter(isValidObjectId))];
  if (wanted.length === 0) return new Map();

  await connectDB();
  const rows = await Product.find({ _id: { $in: wanted } })
    .select("slug")
    .lean<Array<{ _id: unknown; slug?: string }>>();

  const slugs = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.slug === "string" && row.slug.trim()) slugs.set(String(row._id), row.slug);
  }
  return slugs;
}
