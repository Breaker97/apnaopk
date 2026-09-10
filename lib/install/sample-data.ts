import "server-only";

import { connectDB } from "@/lib/db";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import { buildBarcodeRegistryEntries } from "@/lib/products/barcode-registry";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import { getSectionDefinition } from "@/lib/storefront/sections/registry";
import {
  getOrCreateDefaultVendor,
  isMultiVendorOnlyHref,
} from "@/lib/vendors/multi-vendor";
import {
  loadTemplateSnapshot,
  type SnapshotDoc,
  type TemplateSnapshot,
} from "@/lib/install/snapshot";
import {
  BarcodeRegistry,
  BlogCategory,
  BlogPost,
  Brand,
  Category,
  Collection,
  Coupon,
  GlobalVariant,
  InventoryLocation,
  Menu,
  Product,
  Slider,
} from "@/models";
import { getSettings, Settings } from "@/models/settings.model";
import { buildStorePageIdentity, StorePage } from "@/models/store-page.model";

/**
 * The wizard's sample store: the SAME snapshot `pnpm db:seed` imports for the
 * chosen template, so the storefront a buyer lands on is the one they picked
 * from the gallery — its catalog, its collections, its hero, its menus — not a
 * generic list of placeholder products under a starter layout.
 *
 * Four rules separate this from the full demo seed:
 *
 * 1. NO LOGINS. The seed creates vendor, customer and staff accounts with
 *    published passwords; this runs on a store that is about to go live, so
 *    every product is re-owned by the install's own default vendor and not one
 *    extra user account is created. A buyer who wants the multi-vendor demo
 *    runs `pnpm db:seed` against a scratch database.
 * 2. NO OPERATIONAL DATA. No orders, carts, reviews, ledgers or notifications
 *    — nothing that would put invented money in the buyer's reports.
 * 3. NO BRAND. Only presentation settings cross over, and the demo's own logo
 *    and store name are left behind: `general.*` belongs to the buyer, who
 *    just typed their store's name into step 2.
 * 4. NO MARKETPLACE on a single-vendor store. The wizard asks whether this
 *    shop has vendors; when it does not, every piece of vendor content is left
 *    out rather than shipped and hidden — see `isVendorOnlySection`.
 *
 * Everything else lands verbatim through the raw driver, ids included, so the
 * cross-references the snapshot was exported with keep working: products point
 * at real categories and collections, variants at real inventory locations,
 * sections at real sliders and products.
 */

export interface SampleImportResult {
  created: number;
  failed: number;
  /**
   * Whether the storefront layout came from the snapshot. The caller must
   * then activate the theme in "keep" mode — a "publish" would overwrite the
   * curated demo home page with the theme's generic starter.
   */
  storefrontImported: boolean;
}

/**
 * Settings sections the sample brings across: how the store LOOKS, and
 * nothing about how it trades.
 *
 * `general` is excluded because it holds the buyer's own store name, language
 * and currency, all set moments earlier from their answers. `multiVendorMode`,
 * `pos`, `orders`, `shipping`, `checkout` and `vendorConfig` are business
 * decisions, not decoration. `maintenance` carries the demo's own copy.
 */
const PRESENTATION_SECTIONS = [
  "appearance",
  "homePage",
  "header",
  "footer",
  "catalog",
  "productCard",
] as const;

/**
 * Brand fields inside those sections that name or picture the DEMO store.
 * Cleared on the way in, so a buyer's footer shows their store's name rather
 * than this app's logo — the same rule `scripts/debrand-seeded-content.mjs`
 * enforces for seeded content, and the reason the app ships no bundled icon.
 */
const BRAND_PATHS = [
  ["header", "brand", "logoUrl"],
  ["header", "brand", "logoDarkUrl"],
  ["header", "brand", "logoAlt"],
  ["footer", "brand", "logoUrl"],
  ["footer", "brand", "logoDarkUrl"],
  ["footer", "brand", "logoAlt"],
] as const;

/**
 * Whether a piece of imported content only makes sense on a marketplace.
 *
 * Two independent signals, because the storefront only honours the first:
 *
 * - the section's own `available` gate. Asked through the registry rather than
 *   matched against a list of type names, so a section that becomes
 *   vendor-only later is covered without anyone remembering this file.
 * - a link to a vendor-only route. `promotion-banner` is a general-purpose
 *   section with no gate at all, and the Electronics demo uses one to
 *   advertise "Start Selling With Us Today" → `/become-vendor`. On a
 *   single-vendor store that banner renders in full and the click redirects
 *   the shopper straight back to the home page.
 */
function isVendorOnlySection(section: SnapshotDoc): boolean {
  const definition = getSectionDefinition(String(section.type));
  if (definition?.available && !definition.available({ isMultiVendorEnabled: false })) {
    return true;
  }
  return containsVendorLink(section.settings) || containsVendorLink(section.blocks);
}

/** Any vendor-only href anywhere inside a settings/blocks tree. */
function containsVendorLink(value: unknown): boolean {
  if (typeof value === "string") return isMultiVendorOnlyHref(value);
  if (Array.isArray(value)) return value.some(containsVendorLink);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsVendorLink);
  }
  return false;
}

/** Drop menu entries (at any depth) that lead to a vendor-only route. */
function stripVendorMenuItems(items: unknown): unknown[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => !isMultiVendorOnlyHref((item as SnapshotDoc)?.url))
    .map((item) => {
      const entry = item as SnapshotDoc;
      return Array.isArray(entry.children)
        ? { ...entry, children: stripVendorMenuItems(entry.children) }
        : entry;
    });
}

/**
 * The Header Studio's page menu keeps its links in three parallel shapes —
 * the path list, an ordered list of `app:<path>` keys, and a per-key position
 * map. A path removed from one and left in the others resurfaces in the
 * header, so all three are filtered together.
 */
function stripVendorPagesMenu(header: unknown): unknown {
  if (!header || typeof header !== "object") return header;
  const block = header as Record<string, unknown>;
  const pagesMenu = block.pagesMenu as Record<string, unknown> | undefined;
  if (!pagesMenu) return header;

  const keyIsVendor = (key: unknown) =>
    typeof key === "string" &&
    key.startsWith("app:") &&
    isMultiVendorOnlyHref(key.slice("app:".length));

  const positions = pagesMenu.positions as Record<string, unknown> | undefined;
  return {
    ...block,
    pagesMenu: {
      ...pagesMenu,
      appPagePaths: Array.isArray(pagesMenu.appPagePaths)
        ? pagesMenu.appPagePaths.filter((path) => !isMultiVendorOnlyHref(path))
        : pagesMenu.appPagePaths,
      order: Array.isArray(pagesMenu.order)
        ? pagesMenu.order.filter((key) => !keyIsVendor(key))
        : pagesMenu.order,
      positions: positions
        ? Object.fromEntries(
            Object.entries(positions).filter(([key]) => !keyIsVendor(key)),
          )
        : positions,
    },
  };
}

/** Insert documents verbatim, but only into a collection that is still empty. */
async function importDocs(
  model: { collection: { insertMany: (docs: SnapshotDoc[]) => Promise<unknown> } },
  countDocuments: () => Promise<number>,
  docs: SnapshotDoc[],
): Promise<number> {
  if (docs.length === 0) return 0;
  if ((await countDocuments()) > 0) return 0;
  await model.collection.insertMany(docs);
  return docs.length;
}

/**
 * Re-own the whole catalog. The snapshot's vendors are not imported, so every
 * product and every inventory location moves to the install's default vendor —
 * which keeps variant `locationInventory` rows pointing at locations that
 * exist, and their stock counts exact.
 */
function reownToDefaultVendor(docs: SnapshotDoc[], vendorId: unknown) {
  return docs.map((doc) => ({ ...doc, vendorId }));
}

function applyPresentationSettings(
  snapshot: TemplateSnapshot,
  multiVendor: boolean,
) {
  const updates: Record<string, unknown> = {};
  for (const section of PRESENTATION_SECTIONS) {
    const value = snapshot.settings[section];
    if (value !== undefined) updates[section] = value;
  }

  // The theme's own token overrides ride along, but the active theme is set by
  // `applyThemeStarter` — the one writer for that, so the gallery, the wizard
  // and the admin activation cannot disagree about which theme is on.
  const onlineStore = snapshot.settings.onlineStore as
    | { themeSettings?: unknown }
    | undefined;
  if (onlineStore?.themeSettings) {
    updates["onlineStore.themeSettings"] = onlineStore.themeSettings;
  }

  for (const [section, group, field] of BRAND_PATHS) {
    const block = updates[section] as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (block?.[group]?.[field] !== undefined) block[group][field] = "";
  }

  if (!multiVendor && updates.header) {
    updates.header = stripVendorPagesMenu(updates.header);
  }

  return updates;
}

export async function importSampleCatalog(
  adminUserId: string,
  templateId: string,
  { multiVendor, adminName = "Admin" }: { multiVendor: boolean; adminName?: string },
): Promise<SampleImportResult> {
  const snapshot = loadTemplateSnapshot(templateId);
  if (!snapshot) return { created: 0, failed: 0, storefrontImported: false };

  await connectDB();
  const settings = await getSettings();
  const vendor = await getOrCreateDefaultVendor(adminUserId);
  const vendorId = vendor._id;

  // ---- Catalog ----------------------------------------------------------
  await importDocs(Category, () => Category.countDocuments(), snapshot.categories);
  await importDocs(Brand, () => Brand.countDocuments(), snapshot.brands);
  await importDocs(
    GlobalVariant,
    () => GlobalVariant.countDocuments(),
    snapshot.globalVariants,
  );
  await importDocs(
    Collection,
    () => Collection.countDocuments(),
    snapshot.collections,
  );
  await importDocs(
    InventoryLocation,
    () => InventoryLocation.countDocuments(),
    reownToDefaultVendor(snapshot.inventoryLocations, vendorId),
  );

  // Products carry `productSource: "admin"` because the house vendor now owns
  // them: `findDefaultVendorCandidate` reads that provenance to identify the
  // house store when the `isDefault` flag is ever lost.
  //
  // Country of origin is checked against THIS store's policy rather than
  // trusted from the snapshot. The wizard never narrows it, so on a fresh
  // install every origin passes — but a re-run against a store that has since
  // restricted its countries must not import a product the admin form would
  // refuse to save. Cleared, not rejected: the origin is a label on the
  // product, and losing the label beats losing the product.
  const availability = settings.general?.countryAvailability;
  const created = await importDocs(
    Product,
    () => Product.countDocuments(),
    snapshot.products.map((product) => {
      const shipping = product.shipping as
        | { countryOfOrigin?: unknown }
        | undefined;
      const origin = shipping?.countryOfOrigin;
      return {
        ...product,
        vendorId,
        productSource: "admin",
        ...(origin && !isCountryAllowed(origin, availability)
          ? { shipping: { ...shipping, countryOfOrigin: "" } }
          : {}),
      };
    }),
  );

  if (created > 0) {
    // Barcode uniqueness is backed by this registry, not by an index on the
    // product: unregistered barcodes let a later product claim one twice.
    const rows = snapshot.products.flatMap((product) =>
      buildBarcodeRegistryEntries(product).map((entry) => ({
        ...entry,
        productId: product._id,
        active: true,
      })),
    );
    if (rows.length > 0) {
      await BarcodeRegistry.insertMany(rows, { ordered: false }).catch(
        (error: { code?: number }) => {
          // Duplicates across a partial re-run are fine; anything else is not.
          if (error?.code !== 11000) throw error;
        },
      );
    }
  }

  // ---- Storefront content ----------------------------------------------
  await importDocs(Slider, () => Slider.countDocuments(), snapshot.sliders);
  // The demo header menu carries a "Become a Vendor" entry; on a single-vendor
  // store that link redirects the shopper straight back to the home page.
  await importDocs(
    Menu,
    () => Menu.countDocuments(),
    multiVendor
      ? snapshot.menus
      : snapshot.menus.map((menu) => ({
          ...menu,
          items: stripVendorMenuItems(menu.items),
        })),
  );
  await importDocs(
    BlogCategory,
    () => BlogCategory.countDocuments(),
    snapshot.blogCategories,
  );
  await importDocs(
    BlogPost,
    () => BlogPost.countDocuments(),
    snapshot.blogPosts.map((post) => ({
      ...post,
      authorId: adminUserId,
      authorName: adminName,
    })),
  );

  // A `coupon-banner` on the imported home page names a code; the discount has
  // to exist or the storefront advertises something checkout rejects. The
  // window is re-based on today — the exported one closed months ago.
  await importDocs(
    Coupon,
    () => Coupon.countDocuments(),
    snapshot.coupons.map((coupon) => ({
      ...coupon,
      usedCount: 0,
      startDate: new Date(),
      endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      createdBy: adminUserId,
    })),
  );

  // ---- The storefront itself -------------------------------------------
  // Written through the same sanitize the seeder and the builder use, so a
  // section the registry no longer accepts is dropped rather than stored.
  let storefrontImported = false;
  if (snapshot.storePages.length > 0 && (await StorePage.countDocuments()) === 0) {
    const now = new Date();
    // Vendor content is left OUT of a single-vendor store rather than shipped
    // and hidden: the gated sections would render nothing but still sit in the
    // merchant's page builder marked unavailable, and the ungated ones — a
    // promotion banner recruiting vendors — would render for real.
    const usable = (sections: unknown[]) =>
      multiVendor
        ? sections
        : sections.filter(
            (section) => !isVendorOnlySection(section as SnapshotDoc),
          );

    for (const page of snapshot.storePages) {
      const key = String(page.key);
      const draft = page.draft as { sections?: unknown[] } | undefined;
      const published = page.published as { sections?: unknown[] } | undefined;
      await StorePage.updateOne(
        { key },
        {
          $set: {
            ...buildStorePageIdentity(key),
            title: page.title,
            draft: {
              sections: sanitizeSectionInstances(usable(draft?.sections ?? [])),
              updatedAt: now,
              updatedBy: adminUserId,
            },
            ...(published
              ? {
                  published: {
                    sections: sanitizeSectionInstances(
                      usable(published.sections ?? []),
                    ),
                    publishedAt: now,
                    publishedBy: adminUserId,
                  },
                }
              : {}),
            history: [],
          },
        },
        { upsert: true },
      );
    }
    storefrontImported = true;
  }

  const presentation = applyPresentationSettings(snapshot, multiVendor);
  if (Object.keys(presentation).length > 0) {
    await Settings.updateOne({}, { $set: presentation });
  }

  return { created, failed: 0, storefrontImported };
}
