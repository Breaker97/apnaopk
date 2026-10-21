/**
 * Theme key colours migration
 * ===========================
 *
 * Until 3.1 the brand colours were ONE store-wide set: every theme's primary
 * and accent followed them, so giving Electronics a blue primary changed
 * Women Fashion too. In 3.1 each theme owns its key colours (primary,
 * secondary, accent, loading — colour schema 4), and the store-wide brand
 * becomes a mirror of the LIVE theme's, which the dashboards, emails and the
 * mobile apps read.
 *
 * This hands every theme still following the brand its own copy of today's
 * brand colours — nothing changes on screen — and sets the mirror from the
 * live theme. A theme with colours of its own (Furniture's palette, or one a
 * merchant already saved) keeps them. The first save in Theme settings or a
 * theme switch does the same, so this only saves waiting for that. Safe to
 * re-run: an adopted theme is never touched again.
 *
 * Usage:
 *   pnpm db:migrate theme-key-colors --dry-run
 *   pnpm db:migrate theme-key-colors
 */

import { connectDB, disconnectDB, mongoose } from "@/lib/db";
import { resolveBrand } from "@/lib/branding/brand";
import { adoptionUpdates, keyColorMirror, ownThemeTokens } from "@/lib/storefront/themes/key-colors";
import { getActiveThemeManifest } from "@/lib/storefront/themes/registry";

const dryRun = process.argv.includes("--dry-run");

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database connection not available");
  const settings = db.collection("settings");
  const doc = await settings.findOne({}, { projection: { onlineStore: 1, appearance: 1 } });
  if (!doc) {
    console.log("   ✓ no settings document: nothing to adopt");
    return;
  }

  console.log(`\n🎨 Theme key colours migration${dryRun ? " (DRY RUN)" : ""}...\n`);
  const brand = resolveBrand({ appearance: doc.appearance }).colors;
  const adoption = adoptionUpdates(doc.onlineStore, brand);
  const live = getActiveThemeManifest((doc.onlineStore as { activeTheme?: unknown } | undefined)?.activeTheme);
  const mirror = keyColorMirror(ownThemeTokens(live.id, doc.onlineStore, brand), brand);

  const themes = Object.keys(adoption).map((path) => path.split(".")[2]);
  if (themes.length === 0) console.log("   ✓ every theme already owns its key colours");
  for (const [path, colors] of Object.entries(adoption)) {
    const light = (colors as { light?: Record<string, string> }).light ?? {};
    console.log(`   • ${path.split(".")[2]}: primary ${light.primary ?? "its own"}, accent ${light.accent ?? "its own"}`);
  }
  const appearance = (doc.appearance ?? {}) as Record<string, unknown>;
  const mirrorChanges = Object.entries(mirror).filter(([path, value]) => appearance[path.split(".")[1]] !== value);
  for (const [path, value] of mirrorChanges) console.log(`   • ${path} → ${value} (live theme: ${live.id})`);

  if (themes.length === 0 && mirrorChanges.length === 0) {
    console.log("\n✅ Nothing to do");
    return;
  }
  if (dryRun) {
    console.log("\n→ dry run: writing nothing");
    return;
  }
  // Filtered on the theme settings read above, so a save made in the editor
  // while this runs is never overwritten; run again to retry.
  const result = await settings.updateOne(
    { _id: doc._id, "onlineStore.themeSettings": (doc.onlineStore as { themeSettings?: unknown } | undefined)?.themeSettings ?? { $exists: false } },
    { $set: { ...adoption, ...Object.fromEntries(mirrorChanges) } },
  );
  console.log(result.modifiedCount === 1 ? "\n✅ Done" : "\n! The theme settings changed while this ran: nothing written. Run it again.");
}

run()
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
