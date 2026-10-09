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
    when: "push notifications",
    auto: true,
    summary:
      "Replace the plain unique index on pushsubscriptions.endpoint with its partial equivalent; mark existing app installs as the shopper app's and give push tickets their one-day TTL (re-run for the mobile API).",
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
    name: "quote-offer-indexes",
    script: "migrate-quote-offer-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.1",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Add the two quoterequests indexes the quote-price feature reads (shopper list, sign-in claim). Purely additive.",
  },
  {
    name: "notification-delivery-indexes",
    script: "migrate-notification-delivery-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.1",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Create the notification outbox indexes: one email and one text per event (emaildeliveries + smsdeliveries dedupeKey), Twilio receipt lookup, SMS retry sweep and log retention. Purely additive.",
  },
  {
    name: "marketing-consent",
    script: "migrate-marketing-consent.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.3",
    need: "required",
    auto: true,
    summary:
      "Turn the marketingOptIn boolean into a per-channel consent record (state, opt-in level, date, source) and mint the unsubscribe tokens. Subscribers keep their subscription; unwritten rows are read as the boolean until it runs, so nothing is lost by waiting.",
  },
  {
    name: "order-address-indexes",
    script: "migrate-order-address-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.3",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Create the indexes the schemas gained in 2.2 and 2.3 (the customer-profile ones come with marketing-consent): the address-hold sweep, pending carrier refunds, gateway-retry order reuse, the PayPal balance and pay-link lookups, one order per checkout attempt, the checkout-attempt collection, the recovery-ladder sweep and the 90-day purges, the card-testing counters, recurring expenses, collection kinds, the pre-order waitlist and the slider counters. Purely additive.",
  },
  {
    name: "return-refund-payer",
    script: "backfill-return-refund-payer.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "2.3",
    need: "conditional",
    when: "vendors collect cash on delivery themselves",
    auto: true,
    summary:
      "Record whose money each existing return's refund comes out of. A seller who took cash on delivery at their own door refunds it themselves; returns from before 2.3 carry no answer and were read as the store's. Writes only the missing field and moves no money.",
  },

  // ---------------------------------------------------------------- 2.3 → 2.4
  {
    name: "private-storage",
    script: "migrate-private-storage.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "2.4",
    need: "conditional",
    when: "a private bucket",
    // Moves files between buckets, and only after the store has created the
    // private bucket and saved its name — never part of an unattended --all.
    auto: false,
    autoReason:
      "it moves files, and needs the private bucket you create and name first",
    summary:
      "Move the vendor identity documents, digital products and expense receipts already stored into the private bucket (same keys), and delete them from the public one. Until it runs they are still served from the public bucket.",
  },
  {
    name: "store-credit-indexes",
    script: "migrate-store-credit-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "2.4",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Create the indexes the schemas gained in 2.4: store credit's two collections (one balance per shopper and currency, one transaction per idempotency key, the spend, history and upkeep reads), an order's credit hold and exchange links, one marketing suppression per address, and a signed-out shopper's AI conversations. Purely additive.",
  },
  // ---------------------------------------------------------------- 2.4 → 3.0
  {
    name: "mobile-api-indexes",
    script: "migrate-mobile-api-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "3.0",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Create the indexes the mobile apps' API relies on: one idempotency record per caller and key (kept a day), one order per key, the coupon sheet's listed codes and a shopper's own uploads; and the business app's durable operations (one order, payment leg and return per operation, the product editor's receipts, quotes and uploads). Purely additive.",
  },
  {
    name: "activity-log",
    script: "migrate-activity-log.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "3.0",
    need: "conditional",
    when: "you have vendors, or MONGODB_AUTO_INDEX=false",
    auto: true,
    options: ["--indexes-only"],
    optionNotes: {
      "--indexes-only":
        "Create the two audit_logs indexes and skip the backfill.",
    },
    summary:
      "Index the Activity Log, and stamp the audit rows already written by vendor owners and their staff with their store, so a vendor's own log is not empty for everything before the upgrade. Safe to re-run; rows an admin wrote are left unstamped.",
  },
  {
    name: "meta-catalog-indexes",
    script: "migrate-meta-catalog-indexes.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "3.0",
    need: "conditional",
    when: "MONGODB_AUTO_INDEX=false",
    auto: true,
    summary:
      "Create the indexes Settings → Meta catalog relies on: its one row, the live sync's one row per product (unique, so two marks of a product meet on the same row), its due-row claim and refused-items list, and the batch handles Meta is still ingesting (expired automatically). Purely additive.",
  },
  {
    name: "abandoned-checkout-vendors",
    script: "migrate-abandoned-checkout-vendors.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "3.0",
    need: "required",
    when: "multi-vendor",
    auto: true,
    summary:
      "Write each line's seller onto the abandoned checkouts saved before the upgrade, so vendors see their own lines in Orders → Abandoned checkouts, and add the index that list reads. Safe to re-run; the store's own list is unchanged.",
  },
  {
    name: "house-profile",
    script: "migrate-house-profile.mjs",
    runner: "node",
    envFiles: ENV_STRICT,
    since: "3.0",
    need: "conditional",
    when: "installed without demo data, or several vendors carry isDefault",
    // Reports unless told to --apply: the report names vendors only a person
    // can judge (which store is the house, a seller whose flag must stay).
    applyArgs: ["--apply"],
    dryArgs: [],
    auto: false,
    autoReason:
      "Its report names vendors a person must judge — a probable older store profile, a seller still flagged as the store's own — so it is run deliberately, report first.",
    options: ["--adopt=<vendorId>"],
    optionNotes: {
      "--adopt=<vendorId>":
        "When the store has no profile, make this vendor the store's own (the probable older profile the report names). Nothing else about it changes.",
    },
    summary:
      "Report the store's own vendor profile and repair the unambiguous cases: flag or slug a lone house, clear a stray isDefault from vendors with no orders or ledger history, and create the unique slug/userId indexes. Sellers with history keep their flag so finance posts nothing twice.",
  },
  {
    name: "product-search",
    script: "backfill-product-search.ts",
    runner: "tsx",
    envFiles: ENV_STRICT,
    since: "2.1",
    need: "required",
    auto: true,
    options: ["--rebuild"],
    optionNotes: {
      "--rebuild":
        "Recompute every product, not only the ones the index has never seen. Only needed after a search-rule change.",
    },
    summary:
      "Build the per-product search index the storefront search runs on, retire the old text index, and add the Search insights counters' indexes. Until it runs, search falls back to an unindexed substring match.",
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
    options: ["--from=<date>", "--to=<date>"],
    optionNotes: {
      "--from=<date>": "Resume additive posting from this date.",
      "--to=<date>": "Keep a stable end date when resuming a backfill.",
    },
    summary:
      "Replay order and payout history into the finance ledger. Idempotent; without it reports start at upgrade time.",
  },
];

/** Release sections, in upgrade order, for grouping `--list` output. */
export const RELEASES = ["1.4", "1.5", "2.0", "2.1", "2.3", "2.4", "3.0"];

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
 * How to start a migration's process on this platform.
 *
 * Only Windows needs a shell, and only for what is not an `.exe`: the local
 * `tsx` is a `.cmd` shim, which Node will not spawn without one (nor a bare
 * `tsx` found on PATH). Node itself is an `.exe` and is started directly.
 *
 * Through a shell, Node joins the command and its arguments with spaces and
 * quotes nothing. Every migration ran through the shell before, so on a standard
 * Windows install `C:\Program Files\nodejs\node.exe` reached cmd.exe as
 * `C:\Program` and every `node` migration failed to start. For the same reason,
 * a shim path or argument with a space in it is quoted here.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} [platform]
 * @returns {{ command: string, args: string[], shell: boolean }}
 */
export function spawnPlan(command, args, platform = process.platform) {
  if (platform !== "win32" || /\.exe$/i.test(command)) {
    return { command, args, shell: false };
  }
  const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
  return { command: quote(command), args: args.map(quote), shell: true };
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
