import path from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { BSON } from "mongodb";
import { auditSnapshot } from "./seed-audit.mjs";
import {
  listSeedTemplates,
  parseTemplateArg,
  resolveSeedTemplate,
} from "./seed-templates.mjs";

/**
 * Audit the COMMITTED snapshots, with no database in sight.
 *
 * `pnpm db:seed:export` applies the same rules, but only when someone has the
 * source store to export from. This one reads `scripts/seed-data/<template>/`
 * off disk, so it can be run after a hand edit, after a merge that resurrected
 * an old document, or against a snapshot exported before a rule existed —
 * which is exactly how the Classic snapshot arrived carrying the Electronics
 * theme id and seven sliders no page binds.
 *
 * `tests/seed-snapshots.test.ts` asserts the same thing (every snapshot is a
 * fixed point of the audit), so this is the tool that FIXES what that test
 * reports.
 *
 * Usage:
 *   pnpm db:seed:audit                     report on every template
 *   pnpm db:seed:audit --template=essential   report on one
 *   pnpm db:seed:audit --fix               rewrite the files with the repairs
 */

const FIX = process.argv.includes("--fix");

const FILES = [
  ["vendors", "vendors"],
  ["locations", "inventory-locations"],
  ["categories", "categories"],
  ["brands", "brands"],
  ["globalVariants", "global-variants"],
  ["products", "products"],
  ["collections", "collections"],
  ["menus", "menus"],
  ["sliders", "sliders"],
  ["storePages", "store-pages"],
  ["coupons", "coupons"],
  ["blogCategories", "blog-categories"],
  ["blogPosts", "blog-posts"],
  ["vendorPlans", "vendor-plans"],
];

/** The house-store slug — mirrors `appConfig.defaultVendorSlug`. */
const DEFAULT_VENDOR_SLUG = "main-store";

function readJson(file) {
  return BSON.EJSON.parse(readFileSync(file, "utf8"), { relaxed: true });
}

function writeJson(file, payload) {
  writeFileSync(
    file,
    BSON.EJSON.stringify(payload, undefined, 2, { relaxed: true }) + "\n",
  );
}

function auditTemplate(templateId) {
  const { dir } = resolveSeedTemplate(templateId);
  const input = {};
  for (const [key, name] of FILES) {
    const file = path.join(dir, `${name}.json`);
    input[key] = existsSync(file) ? readJson(file) : [];
  }

  const { data, repairs, errors } = auditSnapshot(input, {
    defaultVendorSlug: DEFAULT_VENDOR_SLUG,
  });

  // The audit works on catalog collections; the settings document has one rule
  // of its own, and it is the rule that decides which theme a seeded store
  // comes up wearing. A snapshot naming another template's theme dresses the
  // right catalog in the wrong storefront.
  const settingsFile = path.join(dir, "settings.json");
  let settings = null;
  if (existsSync(settingsFile)) {
    settings = readJson(settingsFile);
    const active = settings.onlineStore?.activeTheme;
    if (active !== templateId) {
      repairs.push(
        `settings: onlineStore.activeTheme ${JSON.stringify(active)} → "${templateId}"`,
      );
      settings.onlineStore = {
        ...(settings.onlineStore ?? {}),
        activeTheme: templateId,
      };
    }
  }

  console.log(`\n📦 ${templateId}`);
  if (errors.length > 0) {
    console.log(`   ❌ ${errors.length} fault(s) the audit will not repair:`);
    for (const error of errors) console.log(`      - ${error}`);
  }
  if (repairs.length === 0 && errors.length === 0) {
    console.log("   ✓ clean");
    return { errors, repairs };
  }
  if (repairs.length > 0) {
    console.log(`   ${FIX ? "🔧 repaired" : "⚠️  would repair"} ${repairs.length}:`);
    for (const repair of repairs) console.log(`      • ${repair}`);
  }

  if (FIX && repairs.length > 0) {
    for (const [key, name] of FILES) {
      const file = path.join(dir, `${name}.json`);
      if (!existsSync(file) && data[key].length === 0) continue;
      writeJson(file, data[key]);
    }
    if (settings) writeJson(settingsFile, settings);

    const manifestFile = path.join(dir, "manifest.json");
    const manifest = existsSync(manifestFile)
      ? JSON.parse(readFileSync(manifestFile, "utf8"))
      : {};
    manifest.template = templateId;
    manifest.counts = Object.fromEntries(
      FILES.map(([key, name]) => [`${name}.json`, data[key].length]),
    );
    manifest.repairedAt = new Date().toISOString();
    manifest.repairs = [...(manifest.repairs ?? []), ...repairs];
    writeFileSync(manifestFile, JSON.stringify(manifest, undefined, 2) + "\n");
  }

  return { errors, repairs };
}

const requested = parseTemplateArg();
const templates = requested ? [requested] : listSeedTemplates();
if (templates.length === 0) {
  console.error("No seed snapshots found under scripts/seed-data.");
  process.exit(1);
}

let failed = false;
let pending = 0;
for (const templateId of templates) {
  const { errors, repairs } = auditTemplate(templateId);
  if (errors.length > 0) failed = true;
  if (!FIX) pending += repairs.length;
}

if (!FIX && pending > 0) {
  console.log(`\nRun \`pnpm db:seed:audit --fix\` to apply ${pending} repair(s).`);
}
console.log("");
process.exit(failed || (!FIX && pending > 0) ? 1 : 0);
