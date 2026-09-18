import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { Category } from "@/models";

export type StorefrontCategory = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  icon?: string;
  seo?: {
    pageTitle?: string;
    metaDescription?: string;
    tags?: string[];
  };
  parentId?: string | null;
  order: number;
  productCount: number;
  children: StorefrontCategory[];
};

type StorefrontCategoryListQuery = {
  flat?: boolean;
  page?: number;
  limit?: number;
  /** Case-insensitive name filter. Flat listings only — a filtered tree
   * would orphan children whose parents don't match. */
  search?: string;
};

type StorefrontCategoryListResult = {
  categories: StorefrontCategory[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};

const CATEGORY_FIELDS =
  "_id name slug description image icon seo parentId order productCount";

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value || 0) > 0 ? Math.floor(value!) : fallback;
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mapCategory(category: {
  _id: unknown;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  icon?: string;
  seo?: {
    pageTitle?: string;
    metaDescription?: string;
    tags?: string[];
  };
  parentId?: unknown | null;
  order?: number;
  productCount?: number;
}): StorefrontCategory {
  return {
    _id: String(category._id),
    name: category.name,
    slug: category.slug,
    description: category.description,
    image: category.image,
    icon: category.icon,
    seo: category.seo,
    parentId: category.parentId ? String(category.parentId) : null,
    order: typeof category.order === "number" ? category.order : 0,
    productCount:
      typeof category.productCount === "number" ? category.productCount : 0,
    children: [],
  };
}

/**
 * Products sit on the leaves, so a parent's own count is close to meaningless
 * to a shopper: the link opens a grid that rolls the branch up, and the number
 * beside it has to say the same thing or the page contradicts itself.
 */
async function buildRolledUpCounts() {
  const rows = await Category.find({})
    .select("_id parentId productCount")
    .lean<{ _id: unknown; parentId?: unknown; productCount?: number }[]>();

  const own = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();

  for (const row of rows) {
    const id = String(row._id);
    own.set(id, typeof row.productCount === "number" ? row.productCount : 0);
    const parentId = row.parentId ? String(row.parentId) : null;
    if (parentId) {
      const siblings = childrenOf.get(parentId) || [];
      siblings.push(id);
      childrenOf.set(parentId, siblings);
    }
  }

  const rolled = new Map<string, number>();
  const totalFor = (id: string, visited = new Set<string>()): number => {
    if (rolled.has(id)) return rolled.get(id) as number;
    if (visited.has(id)) return own.get(id) || 0;
    visited.add(id);
    const total = (own.get(id) || 0) +
      (childrenOf.get(id) || []).reduce(
        (sum, child) => sum + totalFor(child, visited),
        0,
      );
    rolled.set(id, total);
    return total;
  };

  for (const id of own.keys()) totalFor(id);
  return rolled;
}

function applyRolledUpCounts(
  nodes: StorefrontCategory[],
  rolled: Map<string, number>,
) {
  for (const node of nodes) {
    node.productCount = rolled.get(node._id) ?? node.productCount;
    applyRolledUpCounts(node.children, rolled);
  }
}

function sortTree(nodes: StorefrontCategory[]) {
  nodes.sort((a, b) => {
    const orderDiff = a.order - b.order;
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });
  nodes.forEach((node) => sortTree(node.children));
}

export const getStorefrontCategories = unstable_cache(
  async (
    query: StorefrontCategoryListQuery = {},
  ): Promise<StorefrontCategoryListResult> => {
    await connectDB();

    const page = normalizePositiveInteger(query.page, 1);
    const limit = Math.min(normalizePositiveInteger(query.limit, 20), 50);
    const search =
      typeof query.search === "string" ? query.search.trim().slice(0, 80) : "";
    const categoryQuery: Record<string, unknown> = { isActive: true };

    if (query.flat) {
      if (search) {
        categoryQuery.name = {
          $regex: escapeRegexLiteral(search),
          $options: "i",
        };
      }
      const skip = (page - 1) * limit;
      const [categories, total] = await Promise.all([
        Category.find(categoryQuery)
          .select(CATEGORY_FIELDS)
          .sort({ order: 1, name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Category.countDocuments(categoryQuery),
      ]);
      const totalPages = Math.ceil(total / limit);
      const rolled = await buildRolledUpCounts();
      const mapped = categories.map(mapCategory);
      applyRolledUpCounts(mapped, rolled);

      return serialize({
        categories: mapped,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    }

    const categories = await Category.find(categoryQuery)
      .select(CATEGORY_FIELDS)
      .sort({ order: 1, name: 1 })
      .lean();
    const categoryMap = new Map<string, StorefrontCategory>();
    const roots: StorefrontCategory[] = [];

    categories.forEach((category) => {
      const node = mapCategory(category);
      categoryMap.set(node._id, node);
    });

    categoryMap.forEach((node) => {
      if (node.parentId) {
        const parent = categoryMap.get(node.parentId);
        if (parent) {
          parent.children.push(node);
          return;
        }
      }

      roots.push(node);
    });

    sortTree(roots);
    applyRolledUpCounts(roots, await buildRolledUpCounts());

    return serialize({
      categories: roots,
      pagination: {
        page: 1,
        limit: roots.length,
        total: roots.length,
        totalPages: roots.length > 0 ? 1 : 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  },
  ["storefront-categories"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories, CACHE_TAGS.products],
  },
);

export const getStorefrontCategoryBySlug = unstable_cache(
  async (slug: string): Promise<StorefrontCategory | null> => {
    await connectDB();

    const category = await Category.findOne({ slug, isActive: true })
      .select(CATEGORY_FIELDS)
      .lean();

    if (!category) return null;

    const mapped = mapCategory(category);
    // Direct children ride along so a themed header can offer the
    // sub-department row without a second fetch.
    const [rolled, children] = await Promise.all([
      buildRolledUpCounts(),
      Category.find({ parentId: category._id, isActive: true })
        .select(CATEGORY_FIELDS)
        .sort({ order: 1, name: 1 })
        .lean(),
    ]);
    mapped.children = children.map(mapCategory);
    mapped.productCount = rolled.get(mapped._id) ?? mapped.productCount;
    for (const child of mapped.children) {
      child.productCount = rolled.get(child._id) ?? child.productCount;
    }

    return serialize(mapped);
  },
  ["storefront-category-detail"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories, CACHE_TAGS.products],
  },
);

/** One step of a category's trail: enough to name it and link to it. */
export type StorefrontCategoryCrumb = { _id: string; name: string; slug: string };

/**
 * A category's ancestors, root first — what a breadcrumb needs above the
 * category itself. Walks `parentId` up, bounded so a cycle in tampered data
 * ends rather than spins. Empty for a top-level category or an unknown slug.
 */
export const getStorefrontCategoryAncestors = unstable_cache(
  async (slug: string): Promise<StorefrontCategoryCrumb[]> => {
    await connectDB();
    const category = await Category.findOne({ slug, isActive: true })
      .select("_id parentId")
      .lean();
    if (!category) return [];
    const trail: StorefrontCategoryCrumb[] = [];
    let parentId = category.parentId ?? null;
    for (let depth = 0; parentId && depth < 8; depth += 1) {
      const parent = await Category.findOne({ _id: parentId, isActive: true })
        .select("_id name slug parentId")
        .lean();
      if (!parent) break;
      trail.unshift({ _id: String(parent._id), name: parent.name, slug: parent.slug });
      parentId = parent.parentId ?? null;
    }
    return trail;
  },
  ["storefront-category-ancestors"],
  { revalidate: 60, tags: [CACHE_TAGS.categories] },
);
