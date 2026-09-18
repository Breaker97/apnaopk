import { Product, Category } from "@/models";
import { mongoose } from "@/lib/db";
import { ValidationError } from "@/lib/api/errors";
import { MAX_MEGA_MENU_DEPTH } from "@/lib/site-config/menu-depth";

/**
 * Update the product count for a single category
 */
async function updateCategoryProductCount(
  categoryId: string
): Promise<number> {
  const count = await Product.countDocuments({
    category: categoryId,
    status: "active",
  });

  await Category.updateOne({ _id: categoryId }, { productCount: count });
  return count;
}

/**
 * Sync product counts when a product's category changes.
 * Call this after product create/update/delete.
 */
export async function syncProductCategory(
  oldCategoryId: string | null | undefined,
  newCategoryId: string | null | undefined
): Promise<void> {
  const idsToUpdate = new Set<string>();

  if (oldCategoryId) idsToUpdate.add(String(oldCategoryId));
  if (newCategoryId) idsToUpdate.add(String(newCategoryId));

  for (const id of idsToUpdate) {
    await updateCategoryProductCount(id);
  }
}

/**
 * The storefront renders exactly three category levels — the mega menu's rail
 * row, column heading and link — and nothing else in the store reads depth at
 * all: the category page, its filters and its breadcrumb behave the same at
 * any level. A fourth level is therefore reachable only by typing its URL, so
 * the catalog refuses to create one rather than letting merchants build a
 * branch the store cannot show.
 */
export const MAX_CATEGORY_DEPTH = MAX_MEGA_MENU_DEPTH;

type CategoryEdge = { _id: unknown; parentId?: unknown };

/**
 * The whole tree as two lookups. Categories number in the hundreds at most, so
 * one lean pass beats walking the chain with a query per hop.
 */
async function loadCategoryEdges() {
  const rows = await Category.find({})
    .select("_id parentId")
    .lean<CategoryEdge[]>();

  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();

  for (const row of rows) {
    const id = String(row._id);
    const parentId = row.parentId ? String(row.parentId) : null;
    parentOf.set(id, parentId);
    if (parentId) {
      const siblings = childrenOf.get(parentId) || [];
      siblings.push(id);
      childrenOf.set(parentId, siblings);
    }
  }

  return { parentOf, childrenOf };
}

/**
 * How deep the tree would end up if `movingId` — or a brand new leaf when it
 * is omitted — were placed under `parentId`. Moving a category takes its own
 * branch along, so the answer counts the tallest path below it too.
 */
export async function getResultingCategoryDepth(
  parentId: string | null | undefined,
  movingId?: string | null,
): Promise<number> {
  const { parentOf, childrenOf } = await loadCategoryEdges();

  let parentDepth = 0;
  let cursor = parentId ? String(parentId) : null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    parentDepth += 1;
    cursor = parentOf.get(cursor) ?? null;
  }

  const heightOf = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) return 1;
    visited.add(id);
    const children = childrenOf.get(id) || [];
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map((child) => heightOf(child, visited)));
  };

  const movingHeight = movingId ? heightOf(String(movingId)) : 1;
  return parentDepth + movingHeight;
}

/**
 * Every category id under these ones, the given ids included.
 *
 * A product carries exactly one category, so without this a parent link
 * returns nothing at all — the products sit on the leaves. Rolling the branch
 * up is what makes all three navigation levels lead somewhere.
 */
export async function expandCategoryIdsWithDescendants(
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];

  const { childrenOf } = await loadCategoryEdges();
  const collected = new Set<string>();
  const queue = ids.map(String);

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (collected.has(id)) continue;
    collected.add(id);
    queue.push(...(childrenOf.get(id) || []));
  }

  return [...collected];
}

/**
 * Products belong on the leaves, and this is where that rule is enforced.
 *
 * The product picker has always offered leaf categories only, but it was the
 * single place that knew: an import or a direct API call could still file a
 * product on a parent, where the merchant can then never see it again — the
 * picker won't show that category, so re-opening the product silently offers
 * to move it somewhere else.
 *
 * Called only where a product's category is SET or CHANGED. A category that
 * grew children after products were filed on it keeps those products editable,
 * and they still appear on its page: the storefront rolls the branch up with
 * `expandCategoryIdsWithDescendants`, which includes the parent itself.
 */
export async function assertCategoryAcceptsProducts(
  categoryId: string | null | undefined,
): Promise<void> {
  if (!categoryId) return;
  const id = String(categoryId);
  // A malformed id is the schema's business, not this rule's.
  if (!mongoose.Types.ObjectId.isValid(id)) return;

  // One query for the category and its children: the message needs both names.
  const rows = await Category.find({ $or: [{ _id: id }, { parentId: id }] })
    .select("_id name")
    .lean<{ _id: unknown; name: string }[]>();

  const children = rows.filter((row) => String(row._id) !== id);
  if (children.length === 0) return;

  const name = rows.find((row) => String(row._id) === id)?.name;
  throw new ValidationError(
    `${name ? `"${name}"` : "That category"} has sub-categories, and products belong on the deepest level. File this product under ${children
      .slice(0, 3)
      .map((child) => `"${child.name}"`)
      .join(", ")}${children.length > 3 ? " or another sub-category" : ""} instead.`,
  );
}
