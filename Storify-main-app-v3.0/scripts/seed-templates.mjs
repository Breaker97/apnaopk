import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { BSON } from "mongodb";

/**
 * Where the per-template catalog snapshots live, and how a script picks one.
 *
 * Every template in the gallery gets its OWN store: Electronics sells phones
 * and laptops out of five tech vendors, Classic sells a general-goods
 * marketplace. A single shared snapshot cannot serve both — the home page a
 * theme ships is designed around the catalog beneath it, so seeding Classic's
 * catalog under the Electronics starter produces a storefront whose "Shop by
 * Categories" rail advertises categories the store does not sell.
 *
 * So `scripts/seed-data/<templateId>/` holds one complete store each, exported
 * by `pnpm db:seed:export --template=<id>` from that template's own demo
 * database and imported by `pnpm db:seed --template=<id>`. The directory NAME
 * is the theme id from `lib/storefront/themes/registry.ts` — that is the whole
 * binding between a snapshot and the theme it dresses, which is why
 * `listSeedTemplates()` reads the filesystem instead of repeating the id list
 * that the registry already owns.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SEED_DATA_ROOT = path.join(__dirname, "seed-data");

/**
 * The template a script assumes when none is named. It tracks the gallery's
 * default (the first stable manifest in the theme registry) — the pairing is
 * pinned by `tests/seed-templates.test.ts` so renaming the default theme
 * cannot silently leave the seeder pointed at the wrong store.
 */
export const DEFAULT_SEED_TEMPLATE = "electronics";

/** Snapshot files a template directory is made of, in import order. */
export const SNAPSHOT_FILES = [
  "vendors",
  "inventory-locations",
  "categories",
  "brands",
  "global-variants",
  "products",
  "collections",
  "menus",
  "sliders",
  "store-pages",
  "blog-categories",
  "blog-posts",
  "vendor-plans",
  "onboarding-template",
  "settings",
];

/** Template ids that currently have a snapshot on disk. */
export function listSeedTemplates() {
  if (!existsSync(SEED_DATA_ROOT)) return [];
  return readdirSync(SEED_DATA_ROOT)
    .filter((entry) => statSync(path.join(SEED_DATA_ROOT, entry)).isDirectory())
    .sort();
}

export function seedTemplateDir(templateId) {
  return path.join(SEED_DATA_ROOT, templateId);
}

/**
 * Read `--template=<id>` (or `--template <id>`) off a script's argv.
 * Returns null when the flag is absent, so each caller can apply its own
 * fallback — the exporter reads the source store's active theme, the seeder
 * takes DEFAULT_SEED_TEMPLATE.
 */
export function parseTemplateArg(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--template=")) return arg.slice("--template=".length);
    if (arg === "--template") return argv[i + 1] ?? null;
  }
  return null;
}

/**
 * Resolve the template a run should use and fail with the available ids
 * rather than an ENOENT six steps later.
 *
 * `mustExist` is false for the exporter: it CREATES the directory, so a new
 * template's first export must not be refused for not existing yet.
 */
export function resolveSeedTemplate(
  templateId,
  { mustExist = true, label = "template" } = {},
) {
  if (!templateId || !/^[a-z0-9-]+$/.test(templateId)) {
    throw new Error(
      `Invalid ${label} id: ${JSON.stringify(templateId)}. ` +
        "Expected a theme id such as `electronics` or `essential`.",
    );
  }
  const dir = seedTemplateDir(templateId);
  if (mustExist && !existsSync(dir)) {
    const available = listSeedTemplates();
    throw new Error(
      `No seed snapshot for template "${templateId}" (${dir}).\n` +
        (available.length
          ? `Available: ${available.join(", ")}.`
          : "None exported yet.") +
        `\nExport one with: pnpm db:seed:export --template=${templateId}`,
    );
  }
  return { id: templateId, dir };
}

/**
 * Load one snapshot file as EJSON, preserving ObjectIds and dates so every
 * cross-reference in the data survives the round trip.
 */
export function readSnapshotFile(dir, name, { optional = false } = {}) {
  const file = path.join(dir, `${name}.json`);
  if (!existsSync(file)) {
    if (optional) return null;
    throw new Error(
      `Missing seed snapshot: ${file}\n` +
        "The seed imports real catalog data instead of generating placeholders. " +
        `Run \`pnpm db:seed:export --template=${path.basename(dir)}\` against the source store to (re)create it.`,
    );
  }
  return BSON.EJSON.parse(readFileSync(file, "utf8"), { relaxed: true });
}
