import mongoose from "mongoose";

/**
 * Pre-order reliability indexes
 * =============================
 *
 * For a deployment that runs with `MONGODB_AUTO_INDEX=false`: lists the
 * indexes the pre-order reliability work added (orders, products, and the new
 * pre-order operations collection) that the database does not have yet, and
 * with `--apply` creates exactly those. Purely additive — nothing is dropped
 * or changed, and no other model index is touched. With autoIndex on (the
 * default) the app builds these itself and this script reports nothing
 * missing.
 *
 * A database that is not on this machine needs `--allow-remote`.
 *
 * Usage:
 *   tsx --env-file=.env scripts/preorder-reliability-indexes.ts            # dry run
 *   tsx --env-file=.env scripts/preorder-reliability-indexes.ts --apply
 */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

function hostsOf(uri: string): string[] {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/);
  return (match?.[1] || "").split(",").map((host) => host.split(":")[0]).filter(Boolean);
}

async function run() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  if (!uri) {
    console.error("Missing MONGODB_URI in the environment.");
    process.exit(1);
  }
  const hosts = hostsOf(uri);
  const local = hosts.length > 0 && hosts.every((host) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host));
  if (!local && !args.includes("--allow-remote")) {
    console.error(
      `MONGODB_URI points at ${hosts.join(", ") || "an unknown host"}; pass --allow-remote to use a database that is not on this machine.`,
    );
    process.exit(2);
  }

  await mongoose.connect(uri, {
    ...(dbName ? { dbName } : {}),
    autoIndex: false,
    autoCreate: false,
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
  });
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);

  // Which of each schema's indexes belong to this work.
  const ours: Array<{
    model: mongoose.Model<unknown>;
    belongs: (fields: Record<string, unknown>) => boolean;
  }> = [
    {
      model: (await import("@/models/order.model")).Order as unknown as mongoose.Model<unknown>,
      belongs: (fields) =>
        Object.keys(fields).some(
          (key) =>
            key.startsWith("preorderCollection.") ||
            key.startsWith("preorderRelease.") ||
            key.startsWith("preorderDateNotice.") ||
            key === "preorderTermsCheckedAt",
        ) || JSON.stringify(fields) === JSON.stringify({ "items.productId": 1, _id: 1 }),
    },
    {
      model: (await import("@/models/product.model")).Product as unknown as mongoose.Model<unknown>,
      belongs: (fields) => Object.keys(fields).some((key) => key.startsWith("preorderDateSync.")),
    },
    {
      model: (await import("@/models/preorder-operation.model"))
        .PreorderOperation as unknown as mongoose.Model<unknown>,
      belongs: () => true,
    },
  ];

  let missingTotal = 0;
  for (const { model, belongs } of ours) {
    const existing = await model.collection
      .indexes()
      .catch(() => [] as Array<{ key: Record<string, unknown> }>);
    const have = new Set(existing.map((index) => JSON.stringify(index.key)));
    const missing = model.schema
      .indexes()
      .filter(([fields]) => belongs(fields) && !have.has(JSON.stringify(fields)));
    missingTotal += missing.length;
    console.log(`${model.collection.collectionName}: ${missing.length} missing`);
    for (const [fields, options] of missing) {
      console.log(
        `  ${JSON.stringify(fields)}${options && Object.keys(options).length ? ` ${JSON.stringify(options)}` : ""}`,
      );
      if (APPLY) {
        await model.collection.createIndex(
          fields as Record<string, 1 | -1>,
          (options || {}) as Record<string, unknown>,
        );
        console.log("    ✓ created");
      }
    }
  }
  if (!APPLY && missingTotal > 0) console.log("\nDry run — pass --apply to create them.");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
