import mongoose from "mongoose";

/**
 * Omnichannel messaging index migration
 * =====================================
 *
 * Brings existing databases in line with the index set declared by the
 * conversation models. Fresh installs get these from Mongoose autoIndex; this
 * script is for installs where autoIndex is off, and for re-asserting an index
 * whose OPTIONS changed after it was first created.
 *
 * Re-run required: the unique index on `conversationcontacts`
 * (channelIdentities.channelConnectionId, channelIdentities.externalId)
 * shipped without a partial filter, which keys every identity-less live-chat
 * contact as (null, null) and lets only one such contact exist. This script now
 * detects the option mismatch, drops the old index and recreates it partial.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-omnichannel-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-omnichannel-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const INDEXES = {
  conversations: [
    { key: { lastMessageAt: -1, _id: -1 } },
    { key: { status: 1, lastMessageAt: -1, _id: -1 } },
    { key: { ownerVendorId: 1, lastMessageAt: -1, _id: -1 } },
    { key: { ownerVendorId: 1, status: 1, lastMessageAt: -1, _id: -1 } },
    { key: { customerUserId: 1, lastMessageAt: -1, _id: -1 } },
    { key: { guestKeyHash: 1, lastMessageAt: -1, _id: -1 } },
    { key: { ownerType: 1, status: 1, lastMessageAt: -1, _id: -1 } },
    { key: { status: 1, escalationNotifiedAt: 1, lastInboundAt: 1 } },
    { key: { contactId: 1, channel: 1, lastMessageAt: -1 } },
    {
      key: { channelConnectionId: 1, externalThreadId: 1 },
      options: {
        unique: true,
        partialFilterExpression: {
          channelConnectionId: { $type: "objectId" },
          externalThreadId: { $type: "string" },
        },
      },
    },
    {
      key: { activeKey: 1 },
      options: {
        unique: true,
        partialFilterExpression: { activeKey: { $type: "string" } },
      },
    },
    {
      key: { legacySource: 1, legacyConversationId: 1 },
      options: {
        unique: true,
        partialFilterExpression: {
          legacySource: { $type: "string" },
          legacyConversationId: { $type: "objectId" },
        },
      },
    },
  ],
  conversationmessages: [
    { key: { conversationId: 1, createdAt: -1, _id: -1 } },
    { key: { conversationId: 1, _id: 1 } },
    { key: { conversationId: 1, updatedAt: -1 } },
    {
      key: { conversationId: 1, clientMessageId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { clientMessageId: { $type: "string" } },
      },
    },
    {
      key: { channel: 1, providerMessageId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { providerMessageId: { $type: "string" } },
      },
    },
  ],
  conversationcontacts: [
    {
      key: { userId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { userId: { $type: "objectId" } },
      },
    },
    {
      key: { guestKeyHash: 1 },
      options: {
        unique: true,
        partialFilterExpression: { guestKeyHash: { $type: "string" } },
      },
    },
    {
      key: {
        "channelIdentities.channelConnectionId": 1,
        "channelIdentities.externalId": 1,
      },
      options: {
        unique: true,
        partialFilterExpression: {
          "channelIdentities.externalId": { $type: "string" },
        },
      },
    },
  ],
  conversationparticipants: [
    { key: { conversationId: 1, side: 1 } },
    {
      key: { conversationId: 1, userId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { userId: { $type: "objectId" } },
      },
    },
    {
      key: { conversationId: 1, guestKeyHash: 1 },
      options: {
        unique: true,
        partialFilterExpression: { guestKeyHash: { $type: "string" } },
      },
    },
  ],
  channelconnections: [
    { key: { ownerKey: 1, provider: 1 }, options: { unique: true } },
    {
      key: { provider: 1, phoneNumberId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { phoneNumberId: { $type: "string" } },
      },
    },
    {
      key: { provider: 1, pageId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { pageId: { $type: "string" } },
      },
    },
    {
      key: { provider: 1, instagramUserId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { instagramUserId: { $type: "string" } },
      },
    },
    {
      key: { provider: 1, telegramBotId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { telegramBotId: { $type: "string" } },
      },
    },
    {
      key: { telegramWebhookSecretHash: 1 },
      options: {
        unique: true,
        partialFilterExpression: {
          telegramWebhookSecretHash: { $type: "string" },
        },
      },
    },
  ],
  messagingwebhookreceipts: [
    { key: { provider: 1, eventKey: 1 }, options: { unique: true } },
    { key: { status: 1, updatedAt: 1 } },
    {
      key: { createdAt: 1 },
      options: { expireAfterSeconds: 7 * 24 * 60 * 60 },
    },
  ],
  messageoutboxes: [
    { key: { messageId: 1 }, options: { unique: true } },
    { key: { status: 1, nextAttemptAt: 1, leaseUntil: 1 } },
    { key: { status: 1, updatedAt: -1, _id: -1 } },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ],
  whatsapptemplates: [
    {
      key: { channelConnectionId: 1, name: 1, language: 1 },
      options: { unique: true },
    },
    {
      key: {
        channelConnectionId: 1,
        status: 1,
        isActive: 1,
        name: 1,
      },
    },
  ],
};

function indexName(key) {
  return Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
}

/** Existing index specs by name, or null when the collection does not exist. */
async function existingIndexes(db, collectionName) {
  try {
    const specs = await db.collection(collectionName).indexes();
    return new Map(specs.map((spec) => [spec.name, spec]));
  } catch (error) {
    // NamespaceNotFound: nothing has been written to this collection yet.
    if (error?.codeName === "NamespaceNotFound" || error?.code === 26) {
      return null;
    }
    throw error;
  }
}

/** True when the live index already carries the options we want to declare. */
function optionsMatch(existing, desired = {}) {
  if (Boolean(existing.unique) !== Boolean(desired.unique)) return false;
  if (
    (existing.expireAfterSeconds ?? null) !==
    (desired.expireAfterSeconds ?? null)
  ) {
    return false;
  }
  return (
    JSON.stringify(existing.partialFilterExpression ?? null) ===
    JSON.stringify(desired.partialFilterExpression ?? null)
  );
}

async function migrateCollection(db, collectionName, indexes, summary) {
  const existing = await existingIndexes(db, collectionName);
  if (existing === null) {
    console.log(`   • ${collectionName} does not exist yet, skipping`);
    return;
  }

  for (const { key, options = {} } of indexes) {
    const name = indexName(key);
    const live = existing.get(name);
    try {
      if (live && optionsMatch(live, options)) {
        console.log(`   = ${collectionName}.${name} already current`);
        continue;
      }
      if (live) {
        // Same name, different options: createIndex would raise
        // IndexOptionsConflict, so the old definition has to go first.
        if (DRY_RUN) {
          console.log(
            `   [dry-run] would drop + recreate ${collectionName}.${name} (options changed)`,
          );
          summary.changed += 1;
          continue;
        }
        await db.collection(collectionName).dropIndex(name);
        console.log(`   - dropped ${collectionName}.${name} (options changed)`);
      }
      if (DRY_RUN) {
        console.log(`   [dry-run] would create ${collectionName}.${name}`);
        summary.changed += 1;
        continue;
      }
      await db.collection(collectionName).createIndex(key, { name, ...options });
      console.log(`   + created ${collectionName}.${name}`);
      summary.changed += 1;
    } catch (error) {
      // One bad index must not abort the remaining collections.
      summary.failed.push(`${collectionName}.${name}: ${error.message}`);
      console.error(`   ! FAILED ${collectionName}.${name}: ${error.message}`);
    }
  }
}

/**
 * Indexes an earlier build created that a wider index now supersedes. Dropped
 * only after the superseding index is confirmed present — nothing goes blind.
 */
const DROP = {
  conversations: [
    {
      name: "ownerVendorId_1_status_1_lastMessageAt_-1",
      requires: "ownerVendorId_1_status_1_lastMessageAt_-1__id_-1",
    },
    {
      name: "customerUserId_1_lastMessageAt_-1",
      requires: "customerUserId_1_lastMessageAt_-1__id_-1",
    },
    {
      name: "guestKeyHash_1_lastMessageAt_-1",
      requires: "guestKeyHash_1_lastMessageAt_-1__id_-1",
    },
    {
      name: "ownerType_1_status_1_lastMessageAt_-1",
      requires: "ownerType_1_status_1_lastMessageAt_-1__id_-1",
    },
  ],
};

async function dropSuperseded(db, collectionName, summary) {
  const drops = DROP[collectionName];
  if (!drops?.length) return;
  const existing = await existingIndexes(db, collectionName);
  if (existing === null) return;

  for (const { name, requires } of drops) {
    if (!existing.has(name)) continue;
    // In a dry run the superseding index was never actually created, so its
    // absence is expected rather than unsafe.
    if (!existing.has(requires) && !DRY_RUN) {
      console.warn(
        `   ! SKIP drop ${collectionName}.${name}: ${requires} is missing`,
      );
      continue;
    }
    if (DRY_RUN) {
      console.log(
        `   [dry-run] would drop ${collectionName}.${name} (superseded by ${requires})`,
      );
      summary.changed += 1;
      continue;
    }
    try {
      await db.collection(collectionName).dropIndex(name);
      console.log(`   - dropped ${collectionName}.${name} (superseded)`);
      summary.changed += 1;
    } catch (error) {
      summary.failed.push(`${collectionName}.${name}: ${error.message}`);
      console.error(`   ! FAILED drop ${collectionName}.${name}: ${error.message}`);
    }
  }
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");
  await mongoose.connect(uri, {
    ...(process.env.MONGODB_DB_NAME
      ? { dbName: process.env.MONGODB_DB_NAME }
      : {}),
    maxPoolSize: 1,
  });
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is unavailable");

  console.log(
    `\n📇 Omnichannel index migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
  );
  const summary = { changed: 0, failed: [] };
  for (const [collectionName, indexes] of Object.entries(INDEXES)) {
    console.log(`-- ${collectionName} --`);
    await migrateCollection(db, collectionName, indexes, summary);
    await dropSuperseded(db, collectionName, summary);
  }

  console.log(
    `\n${DRY_RUN ? "Dry run complete (no changes made)." : "Migration complete."} ${summary.changed} index(es) ${DRY_RUN ? "would change" : "changed"}.`,
  );
  if (summary.failed.length) {
    console.error(`\n❌ ${summary.failed.length} index(es) failed:`);
    for (const failure of summary.failed) console.error(`   - ${failure}`);
    throw new Error("Index migration completed with failures");
  }
  console.log("");
}

try {
  await run();
} finally {
  await mongoose.disconnect();
}
