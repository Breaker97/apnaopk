/**
 * The one registry of upgrade migrations, and the only place their names live.
 *
 * Every entry here used to be TWO package.json scripts — `db:migrate:<name>`
 * and `db:migrate:<name>:dry` — which is how 43 migrations became 86 lines of
 * near-identical `node --env-file=.env scripts/...` incantations. The runner
 * (`scripts/migrate.mjs`) reads this table instead, so adding a migration is
 * one object here rather than two more script lines to keep in sync.
 *
 * `tests/migrations-registry.test.ts` pins the table against the scripts on
 * disk and against `docs/UPGRADE.md`, because this list is buyer-facing: the
 * upgrade guide walks people through these names one release at a time, and a
 * name that exists in only one of the two places is a buyer typing a command
 * that does not run.
 *
 * Field notes:
 *
 * - `runner` is NOT derivable from the extension. Four `.mjs` migrations
 *   (`ledger`, `drop-pickup-slots`, `drop-boost-packages`) run under `tsx`
 *   because they import through the `@/` alias, which bare node cannot
 *   resolve. It stays explicit so nobody "simplifies" it back into a bug.
 *
 * - `envFiles` is preserved per migration exactly as it was in package.json.
 *   Two of them read `.env.local` as well; the rest read only `.env`. Do not
 *   unify these — a developer whose `.env.local` points at a different cluster
 *   would silently migrate the wrong database.
 *
 * - `applyArgs` / `dryArgs` exist because four migrations predate the
 *   `--dry-run` convention: `loyalty` gates on `--all --apply`, and
 *   `vendor-owner-roles` reports unless given `--apply`. The runner translates
 *   one uniform `--dry-run` into whatever each script actually parses, so the
 *   documented CLI is consistent even where the scripts are not.
 *
 * - `auto` is whether `--all` may run it. False means the migration costs money
 *   (geocoding, Stripe), moves files, or has a dry pass a human must read and
 *   act on before the write pass is safe. Those are listed for the operator to
 *   run deliberately, one at a time.
 */

/** `--env-file=.env` — the default: fail loudly if there is no .env. */
const ENV_STRICT = "strict";
/** `--env-file-if-exists` for .env and .env.local both. */
const ENV_OPTIONAL = "optional";

/**
 * Ordered as `--all` runs them, which is documented upgrade order — 1.4, then
 * 1.5, then 2.0 — with ONE deliberate exception: `ledger` ships in 1.5 but sits
 * after `refund-allocations` (2.0) here. UPGRADE.md's "ordering matters" note
 * is the reason: refund-allocations repairs historic refund rows, and the
 * ledger has to be posted after them or the repaired rows never reach the
 * books. `since` still reports 1.5, so `--list` groups it where a buyer
 * crossing 1.4→1.5 expects to find it.
 */
export const MIGRATIONS = [
  // ---------------------------------------------------------------- 1.3 → 1.4
  {
    name: "audit-indexes",
    script: "migrate-audit-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    auto: true,
    summary:
      "Bring indexes in line with the models, drop stale ones autoIndex cannot, reset audit retention.",
  },
  {
    name: "vendor-zone-rates",
    script: "migrate-vendor-zone-rates.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    when: "multi-vendor",
    auto: true,
    summary: "Move vendors off their own shipping zones onto the store's.",
  },
  {
    name: "location-vendor",
    script: "backfill-location-vendor.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    when: "multi-vendor",
    auto: true,
    summary:
      "Give every inventory location an owning vendor (they used to be platform-global).",
  },
  {
    name: "reconcile-stock",
    script: "reconcile-product-stock.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    // Refuses to run without a direction, and only the merchant knows which
    // one is right — so it can never be part of an unattended --all.
    auto: false,
    autoReason:
      "it needs --source=locations or --source=stock, and only you know which side is right",
    options: ["--source=stock", "--source=locations"],
    optionNotes: {
      "--source=stock":
        "The running total wins; lower the location rows to match. Safer on a live store — overselling takes money for goods that are not there.",
      "--source=locations":
        "The counted shelf wins; raise stock to match. Risks re-selling units that already shipped.",
    },
    summary:
      "Realign product stock with the per-location quantities beneath it. Requires --source.",
  },
  {
    name: "drop-pickup-slots",
    script: "drop-pickup-slot-booking.mjs",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "recommended",
    auto: true,
    summary:
      "Remove what the retired pickup slot-booking feature left behind (pickup now runs on opening hours).",
  },
  {
    name: "vendor-geo",
    script: "backfill-vendor-geo.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "conditional",
    when: "location search",
    auto: true,
    options: ["--geocode"],
    optionNotes: {
      "--geocode":
        "Also call a geocoding API for vendors with no coordinates at all. Costs API calls.",
    },
    summary:
      "Backfill Vendor.address.geo from the legacy { lat, lng } pair so radius search can see those vendors.",
  },
  {
    name: "location-geo",
    script: "backfill-location-geo.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "conditional",
    when: "location search",
    auto: true,
    options: ["--geocode"],
    optionNotes: {
      "--geocode":
        "Also resolve each branch's own free-text address. Costs API calls.",
    },
    summary:
      'Put a point on every collection branch, so "near me" measures from the branch and not the vendor payout address.',
  },
  {
    name: "account-status",
    script: "migrate-account-status.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    auto: true,
    summary:
      "Clear stale inactive status on admin/staff/seller accounts, which 1.4 started enforcing (lockout risk).",
  },
  {
    name: "push",
    script: "migrate-push-subscriptions.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    when: "web push",
    auto: true,
    summary:
      "Replace the plain unique index on pushsubscriptions.endpoint with its partial equivalent.",
  },
  {
    name: "omnichannel",
    script: "migrate-omnichannel-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    when: "multi-channel messaging",
    auto: true,
    summary:
      "Re-assert the conversation indexes; the contact unique index shipped without its partial filter.",
  },
  {
    name: "telegram-keys",
    script: "migrate-telegram-message-keys.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "required",
    when: "Telegram",
    auto: true,
    summary:
      "Rewrite bare Telegram message ids to the <chatId>:<messageId> key (dropped inbound, re-sent outbound).",
  },
  {
    name: "support-conversations",
    script: "migrate-support-conversations.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "conditional",
    when: "old support threads",
    auto: true,
    summary:
      "Import historical supportconversations into the omnichannel inbox. Idempotent.",
  },
  {
    name: "barcodes",
    script: "backfill-barcode-registry.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "conditional",
    when: "barcodes",
    // The dry pass reports duplicate barcodes that a human must resolve before
    // the write pass can succeed. Never part of an unattended --all.
    auto: false,
    autoReason: "its dry pass reports duplicates you must resolve first",
    summary:
      "Build the barcode registry that owns normalized barcode uniqueness across products and variants.",
  },
  {
    name: "vendor-billing",
    script: "backfill-vendor-subscription-billing.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.4",
    need: "conditional",
    when: "vendor plans on Stripe",
    auto: false,
    autoReason: "it calls Stripe and reports missing references you must review",
    summary: "Backfill vendor subscription billing snapshots from Stripe.",
  },

  // ---------------------------------------------------------------- 1.4 → 1.5
  {
    name: "guest-customers",
    script: "migrate-guest-customer-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    auto: true,
    summary:
      "Rebuild customerprofiles.userId_1 as a partial unique index for guest checkout, and delete phantom profiles.",
  },
  {
    name: "storage-credentials",
    script: "migrate-storage-credentials.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    auto: true,
    summary:
      "Split the one flat credential set on settings.storage into per-provider blocks.",
  },
  {
    name: "carrier-shipments",
    script: "migrate-carrier-shipments.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    auto: true,
    summary:
      "Rebuild the Shipment indexes; trackingNumber was in a plain unique index a rate-shopped draft cannot satisfy.",
  },
  {
    name: "webhook-provider",
    script: "migrate-webhook-event-provider.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    auto: true,
    summary:
      "Make webhookevents multi-provider and give it a retention window (it kept every event forever).",
  },
  {
    name: "suborder-carrier",
    script: "backfill-suborder-carrier.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "multi-vendor",
    auto: true,
    summary:
      "Give each SubOrder its own carrier; on a split order the second vendor to ship overwrote the first.",
  },
  {
    name: "suborder-payment",
    script: "backfill-suborder-payment-status.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "multi-vendor",
    auto: true,
    summary: "Give each SubOrder its own paymentStatus, for the same reason.",
  },
  {
    name: "commission-source",
    script: "backfill-commission-source.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "multi-vendor",
    auto: true,
    summary:
      "Stamp Vendor.commissionSource so a negotiated rate can be told apart from the store default.",
  },
  {
    name: "boosts",
    script: "migrate-boost-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "boosting",
    auto: true,
    summary: "Create the boosting indexes on existing installs.",
  },
  {
    name: "boost-permissions",
    script: "migrate-boost-permissions.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "boosting",
    auto: true,
    summary:
      "Grant view_boosts / manage_boosts to vendors that predate the feature (they cannot see the screens otherwise).",
  },
  {
    name: "drop-boost-packages",
    script: "drop-boost-packages.mjs",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "boosting",
    auto: true,
    summary:
      "Remove the flat-fee boost package rows; boosts are now a numbered ladder position booked for a date range.",
  },
  {
    name: "drop-stocks-inventory",
    script: "migrate-drop-stocks-inventory.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "recommended",
    auto: true,
    summary:
      "Retire InventoryLocation.stocksInventory, a flag no route or form could ever set.",
  },
  {
    name: "subscription-currency",
    script: "backfill-subscription-currency.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "conditional",
    when: "vendor plans",
    auto: true,
    summary: 'Repair plan snapshots stamped with the placeholder currency "USD".',
  },
  {
    name: "loyalty",
    script: "backfill-loyalty-points.ts",
    runner: "tsx",
    envFiles: ENV_OPTIONAL,
    since: "1.5",
    need: "conditional",
    when: "loyalty points",
    // Predates --dry-run: the script gates writing on --apply and requires a
    // scope (--all or --email) in both directions.
    applyArgs: ["--all", "--apply"],
    dryArgs: ["--all"],
    auto: false,
    autoReason: "it grants points, which is wrong on a store that has none",
    summary: "Backfill loyalty points from order history.",
  },
  {
    name: "media-to-cloud",
    script: "migrate-media-to-cloud.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "local uploads",
    auto: false,
    autoReason: "you must configure a storage provider before it can move files",
    summary:
      "Move existing public/uploads and private-uploads files to your configured storage provider.",
  },
  {
    name: "debrand",
    script: "debrand-seeded-content.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "optional",
    when: "you seeded demo data",
    auto: false,
    autoReason: "it only applies to stores seeded with the demo catalog",
    summary:
      "Clear this app's own name out of seeded fields that outrank general.storeName.",
  },

  // ---------------------------------------------------------------- 1.5 → 2.0
  {
    name: "store-pages",
    script: "migrate-store-pages.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "required",
    auto: true,
    summary:
      "Bring the storefront onto the theme engine: canonical page keys, then publish settings.homePage as a document.",
  },
  {
    name: "staff-ownership",
    script: "migrate-staff-ownership.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "recommended",
    auto: true,
    summary:
      "Stamp managedBy on every staff profile so ownership stops being inferred from the vendor-scope array.",
  },
  {
    name: "team-roles",
    script: "migrate-team-roles.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "recommended",
    auto: true,
    summary:
      "Rewrite the legacy seller role to staff, and designate the oldest active admin as store Owner. Idempotent.",
  },
  {
    name: "retire-vendor-perms",
    script: "migrate-retire-decorative-vendor-permissions.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "required",
    when: "multi-vendor",
    auto: true,
    summary:
      "Retire eleven decorative vendor permissions. Not safe to skip — see UPGRADE.md.",
  },
  {
    name: "notifications",
    script: "migrate-notification-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Add the index the notification poller validates against. Purely additive.",
  },
  {
    name: "vendor-access",
    script: "migrate-vendor-permission-overrides.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "recommended",
    auto: true,
    summary:
      "Move vendors from the legacy Vendor.permissions array onto plan entitlements plus explicit overrides.",
  },
  {
    name: "pack-policy",
    script: "migrate-vendor-pack-policy.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "recommended",
    auto: true,
    summary:
      "Replace eight marketplace policy booleans with one switch per capability pack.",
  },
  {
    name: "vendor-owner-roles",
    script: "reconcile-vendor-owner-roles.ts",
    runner: "tsx",
    envFiles: ENV_OPTIONAL,
    since: "2.0",
    need: "recommended",
    // Predates --dry-run: reports unless told to --apply. It never demotes.
    applyArgs: ["--apply"],
    dryArgs: [],
    auto: true,
    summary:
      "Realign each vendor owner's user.role with the vendor record they own. Never demotes.",
  },
  {
    name: "charge-fees",
    script: "backfill-charge-fees.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "conditional",
    when: "card or mobile-money payments",
    auto: true,
    summary:
      "Copy each paid order's gateway fee onto its charge transaction, so dashboard net stops equalling gross.",
  },
  {
    name: "phase3-indexes",
    script: "migrate-phase3-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Add the two indexes the query audit found missing (user.status, platformpayments). Purely additive.",
  },
  {
    name: "refund-allocations",
    script: "backfill-refund-allocations.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "2.0",
    need: "conditional",
    when: "you have processed refunds",
    auto: true,
    summary:
      "Record what each historic refund reversed, per consignment. Run it after the 2.0 code is deployed.",
  },
  {
    // Ships in 1.5, but sequenced here: refund-allocations must repair the
    // refund rows before the ledger posts them. See the block comment above.
    name: "ledger",
    script: "backfill-ledger.mjs",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "1.5",
    need: "required",
    when: "Finance",
    auto: true,
    options: ["--from=<date>", "--rebuild", "--method=<method>"],
    optionNotes: {
      "--from=<date>": "Post only entries from this date onward.",
      "--rebuild":
        "Delete the entries in scope and post them again. NOT part of a normal upgrade — only after a posting rule changes.",
      "--method=<method>": "Narrow --rebuild to one payment method.",
    },
    summary:
      "Replay order and payout history into the finance ledger. Idempotent; without it reports start at upgrade time.",
  },
];

/** Release sections, in upgrade order, for grouping `--list` output. */
export const RELEASES = ["1.4", "1.5", "2.0"];

const BY_NAME = new Map(MIGRATIONS.map((m) => [m.name, m]));

export function getMigration(name) {
  return BY_NAME.get(name) ?? null;
}

/** Migrations `--all` may run, in execution order. */
export function autoMigrations() {
  return MIGRATIONS.filter((m) => m.auto);
}

/** Migrations `--all` deliberately skips, with the reason to show the operator. */
export function manualMigrations() {
  return MIGRATIONS.filter((m) => !m.auto);
}

/**
 * The argv a migration is invoked with. `--dry-run` is the ONE uniform flag;
 * this is where it becomes whatever the underlying script actually parses.
 *
 * @param {{ applyArgs?: string[], dryArgs?: string[] }} migration
 * @param {{ dryRun?: boolean, extra?: string[] }} [options]
 * @returns {string[]}
 */
export function migrationArgs(
  migration,
  { dryRun = false, extra = /** @type {string[]} */ ([]) } = {},
) {
  const base = dryRun
    ? (migration.dryArgs ?? ["--dry-run"])
    : (migration.applyArgs ?? []);
  return [...base, ...extra];
}

/**
 * The node flags that load a migration's environment.
 *
 * @param {{ envFiles?: string }} migration
 * @returns {string[]}
 */
export function envFileFlags(migration) {
  return migration.envFiles === ENV_OPTIONAL
    ? ["--env-file-if-exists=.env", "--env-file-if-exists=.env.local"]
    : ["--env-file=.env"];
}

/** How a migration is described in `--list` / UPGRADE.md ("Run it?" column). */
export function needLabel(migration) {
  const { need, when } = migration;
  if (need === "required") return when ? `Required if ${when}` : "Required";
  if (need === "recommended") return "Recommended";
  if (need === "optional") return when ? `Optional — ${when}` : "Optional";
  return when ? `If you use ${when}` : "Conditional";
}
