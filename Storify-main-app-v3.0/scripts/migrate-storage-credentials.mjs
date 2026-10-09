import mongoose from "mongoose";

/**
 * Storage credential migration (per-provider blocks)
 * ==================================================
 *
 * Storage credentials used to sit in one flat set on `settings.storage`: a
 * single `accessKeyId` / `secretAccessKey` / `bucketName` / `publicUrl` that
 * whichever provider was active had claimed. Every other integration in the app
 * — payments above all — gives each provider its own block, and storage was the
 * odd one out, in the wrong direction: configuring one backend overwrote the
 * keys of the one that was still serving the store.
 *
 * v1.5 also settles the provider list: Cloudflare R2, AWS S3, MinIO and
 * DigitalOcean Spaces. This moves the flat values into the block that matches
 * the active provider, then clears the old fields.
 *
 * Two cases get re-pointed rather than copied straight across:
 *
 *  - **provider "s3" with a custom endpoint.** That was never real AWS — it was
 *    someone running Wasabi, Backblaze or MinIO through the S3 option. The S3
 *    block has no endpoint field (the SDK derives it from the region), so those
 *    installs become provider "minio", the one backend that takes an endpoint.
 *    Left in the s3 block the endpoint would be silently dropped and every
 *    request would go to Amazon instead.
 *
 *  - **provider "local".** Retired in v1.5. Files already on disk keep being
 *    served by the /uploads/* route, but nothing can upload until a real
 *    provider is configured. Any flat credentials found are leftovers from a
 *    previous cloud setup, so they are parked in the r2 block (the default the
 *    admin now lands on) and the provider is left alone for the admin to
 *    choose deliberately.
 *
 * Safety: the copy is verified field-by-field against a re-read of the document
 * before anything is unset. If a single value does not match, the flat fields
 * are left in place and the run reports it — the resolver still reads them as a
 * fallback, so an aborted migration degrades to "nothing happened".
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-storage-credentials.mjs            (apply)
 *   node --env-file=.env scripts/migrate-storage-credentials.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const LEGACY_FIELDS = [
  "accountId",
  "endpoint",
  "region",
  "bucketName",
  "accessKeyId",
  "secretAccessKey",
  "publicUrl",
];

/** Fields each block actually reads. Anything else is dropped, loudly. */
const BLOCK_FIELDS = {
  r2: ["accountId", "bucketName", "accessKeyId", "secretAccessKey", "publicUrl"],
  s3: ["region", "bucketName", "accessKeyId", "secretAccessKey", "publicUrl"],
  minio: [
    "endpoint",
    "region",
    "bucketName",
    "accessKeyId",
    "secretAccessKey",
    "publicUrl",
  ],
  digitalocean: [
    "region",
    "bucketName",
    "accessKeyId",
    "secretAccessKey",
    "publicUrl",
  ],
};

/** Secrets are never printed — only whether a value is present. */
const SECRET_FIELDS = new Set(["accessKeyId", "secretAccessKey", "accountId"]);

function isSet(value) {
  return typeof value === "string" && value.trim() !== "";
}

function display(field, value) {
  return SECRET_FIELDS.has(field) ? "<set>" : value;
}

/**
 * Decide where this document's flat credentials belong, and whether the
 * provider itself has to change.
 */
function resolveTarget(storage) {
  switch (storage.provider) {
    case "s3":
      // A custom endpoint means it was never Amazon — see the header.
      return isSet(storage.endpoint)
        ? { block: "minio", newProvider: "minio" }
        : { block: "s3" };
    case "minio":
      return { block: "minio" };
    case "digitalocean":
      return { block: "digitalocean" };
    case "local":
      return { block: "r2", retiredLocal: true };
    default:
      return { block: "r2" };
  }
}

function planMove(storage, block) {
  const existing = storage[block] || {};
  const moves = {};
  const skipped = [];

  for (const field of LEGACY_FIELDS) {
    const value = storage[field];
    if (!isSet(value)) continue;

    if (!BLOCK_FIELDS[block].includes(field)) {
      skipped.push(`${field} (not used by ${block})`);
      continue;
    }
    // "auto" is R2's convention; anywhere else the schema default is honest.
    if (field === "region" && value.trim() === "auto") {
      skipped.push("region ('auto' — schema default applies)");
      continue;
    }
    // Never overwrite a value already configured in the block.
    if (isSet(existing[field])) {
      skipped.push(`${field} (block already set)`);
      continue;
    }
    moves[field] = value;
  }

  return { moves, skipped };
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Pass --env-file=.env");
    throw new Error("Missing MONGODB_URI");
  }

  console.log(
    `\nStorage credential migration${DRY_RUN ? " (dry run — no changes)" : ""}\n`,
  );

  await mongoose.connect(uri);
  const { host, name } = mongoose.connection;
  console.log(`✓ Connected to MongoDB — ${host}/${name}\n`);

  try {
    const settings = mongoose.connection.db.collection("settings");

    const docs = await settings
      .find({
        $or: [
          ...LEGACY_FIELDS.map((field) => ({
            [`storage.${field}`]: { $nin: [null, ""] },
          })),
          { "storage.provider": "local" },
        ],
      })
      .toArray();

    if (docs.length === 0) {
      console.log(
        "Nothing to do — no settings document holds flat storage credentials.",
      );
      return;
    }

    let migrated = 0;
    let failed = 0;

    for (const doc of docs) {
      const storage = doc.storage || {};
      const { block, newProvider, retiredLocal } = resolveTarget(storage);
      const { moves, skipped } = planMove(storage, block);
      const fields = Object.keys(moves);

      console.log(
        `Settings ${doc._id} — provider=${storage.provider || "(unset)"} → storage.${block}`,
      );
      if (newProvider) {
        console.log(
          `  ⚠ custom endpoint on provider "s3" — switching provider to "${newProvider}" (the S3 block cannot hold an endpoint)`,
        );
      }
      if (retiredLocal) {
        console.log(
          "  ⚠ provider is \"local\", retired in v1.5. Files already on disk keep serving from /uploads/*, " +
            "but uploads need a provider — pick one in Settings → Storage. Provider left unchanged here.",
        );
      }
      for (const field of fields) {
        console.log(
          `  ${field}: ${display(field, moves[field])} → storage.${block}.${field}`,
        );
      }
      for (const note of skipped) {
        console.log(`  – dropped ${note}`);
      }

      if (DRY_RUN) continue;

      if (fields.length > 0) {
        await settings.updateOne(
          { _id: doc._id },
          {
            $set: Object.fromEntries(
              fields.map((field) => [`storage.${block}.${field}`, moves[field]]),
            ),
          },
        );

        // Verify against a re-read before destroying the source. A reported
        // success is not evidence the value landed.
        const after = await settings.findOne(
          { _id: doc._id },
          { projection: { [`storage.${block}`]: 1 } },
        );
        const written = after?.storage?.[block] || {};
        const mismatched = fields.filter(
          (field) => written[field] !== moves[field],
        );

        if (mismatched.length > 0) {
          failed++;
          console.log(
            `  ❌ verification failed for: ${mismatched.join(", ")} — flat fields left in place`,
          );
          continue;
        }
        console.log(`  ✓ verified ${fields.length} field(s)`);
      }

      await settings.updateOne(
        { _id: doc._id },
        {
          $unset: Object.fromEntries(
            LEGACY_FIELDS.map((field) => [`storage.${field}`, ""]),
          ),
          $set: {
            ...(newProvider ? { "storage.provider": newProvider } : {}),
            updatedAt: new Date(),
          },
        },
      );
      console.log("  ✓ flat fields removed");
      migrated++;
    }

    if (DRY_RUN) {
      console.log("\nDry run complete. Re-run without --dry-run to apply.");
      return;
    }

    console.log(`\n✅ Migrated ${migrated} settings document(s).`);
    if (failed > 0) {
      console.log(
        `⚠️  ${failed} document(s) failed verification and were left untouched — the app still reads their flat fields.`,
      );
      throw new Error("Verification failed");
    }
  } catch (error) {
    console.error("\n❌ Storage credential migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
