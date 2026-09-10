import "server-only";

import { existsSync, readFileSync } from "fs";
import path from "path";
import { BSON } from "mongodb";

/**
 * Read a template's catalog snapshot at RUNTIME, off disk.
 *
 * The snapshots in `scripts/seed-data/<template>/` are the same files
 * `pnpm db:seed` imports — one complete demo store per theme, exported and
 * integrity-checked by `pnpm db:seed:export`. Sharing them with the install
 * wizard is the point: a buyer who ticks "sample data" gets the store they
 * saw in the template gallery, not a generic placeholder catalog.
 *
 * Read rather than `import`ed because a template snapshot is ~1 MB of JSON.
 * A static import inlines every template into a server chunk, paid on every
 * build and held in memory for a route a store runs exactly once; the files
 * are traced into the deployment by `outputFileTracingIncludes` in
 * `next.config.ts` instead. That trace entry is what makes this work in
 * production — a snapshot missing from the bundle would leave the wizard's
 * sample import silently doing nothing.
 *
 * EJSON, not JSON: documents carry `$oid`/`$date` wrappers so every
 * cross-reference in the data (product → category/collection, variant →
 * location, section → slider handle) survives the round trip with its ids
 * intact, exactly as the seeder imports them.
 */

const SEED_DATA_ROOT = path.join(process.cwd(), "scripts", "seed-data");

/** A snapshot document, kept loose — these are raw-driver inserts. */
export type SnapshotDoc = Record<string, unknown>;

export interface TemplateSnapshot {
  templateId: string;
  categories: SnapshotDoc[];
  brands: SnapshotDoc[];
  globalVariants: SnapshotDoc[];
  collections: SnapshotDoc[];
  inventoryLocations: SnapshotDoc[];
  products: SnapshotDoc[];
  sliders: SnapshotDoc[];
  menus: SnapshotDoc[];
  coupons: SnapshotDoc[];
  blogCategories: SnapshotDoc[];
  blogPosts: SnapshotDoc[];
  storePages: SnapshotDoc[];
  settings: SnapshotDoc;
}

function readFile(dir: string, name: string): SnapshotDoc[] {
  const file = path.join(dir, `${name}.json`);
  if (!existsSync(file)) return [];
  const parsed = BSON.EJSON.parse(readFileSync(file, "utf8"), {
    relaxed: true,
  }) as unknown;
  return Array.isArray(parsed) ? (parsed as SnapshotDoc[]) : [];
}

/** Whether this template ships a sample store the wizard can import. */
function hasTemplateSnapshot(templateId: string): boolean {
  if (!/^[a-z0-9-]+$/.test(templateId)) return false;
  return existsSync(path.join(SEED_DATA_ROOT, templateId, "products.json"));
}

/**
 * Load one template's snapshot, or null when it has none — a theme may ship
 * without a sample store, and that must degrade to "install starts empty"
 * rather than failing the install.
 */
export function loadTemplateSnapshot(
  templateId: string,
): TemplateSnapshot | null {
  if (!hasTemplateSnapshot(templateId)) return null;
  const dir = path.join(SEED_DATA_ROOT, templateId);
  const settingsFile = path.join(dir, "settings.json");
  const settings = existsSync(settingsFile)
    ? (BSON.EJSON.parse(readFileSync(settingsFile, "utf8"), {
        relaxed: true,
      }) as SnapshotDoc)
    : {};

  return {
    templateId,
    categories: readFile(dir, "categories"),
    brands: readFile(dir, "brands"),
    globalVariants: readFile(dir, "global-variants"),
    collections: readFile(dir, "collections"),
    inventoryLocations: readFile(dir, "inventory-locations"),
    products: readFile(dir, "products"),
    sliders: readFile(dir, "sliders"),
    menus: readFile(dir, "menus"),
    coupons: readFile(dir, "coupons"),
    blogCategories: readFile(dir, "blog-categories"),
    blogPosts: readFile(dir, "blog-posts"),
    storePages: readFile(dir, "store-pages"),
    settings,
  };
}
