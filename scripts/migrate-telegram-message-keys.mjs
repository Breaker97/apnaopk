import mongoose from "mongoose";

/**
 * Telegram provider-message-id scoping migration
 * ==============================================
 *
 * Telegram's `message_id` is a per-CHAT counter that restarts at 1 for every
 * conversation, but Storify deduplicates inbound messages — and uniquely
 * indexes them — as `{channel, providerMessageId}`, which is global per
 * channel. Storing the bare id therefore made customer B's message #1 look like
 * a duplicate of customer A's message #1: it was silently dropped on ingest,
 * and an outbound reply that collided with the index was misclassified as a
 * retryable failure and re-sent up to eight times.
 *
 * The code now stores `<chatId>:<messageId>`. This script rewrites the rows
 * that were written before that change, so the old and new formats do not
 * coexist (a mixed collection would keep colliding).
 *
 * The chat id is the conversation's `externalThreadId`, so every row is
 * migrated from its own conversation — no Telegram API calls are made.
 *
 * Rows whose scoped key would collide with an existing row are reported and
 * left alone rather than deleted: a collision means two chats genuinely shared
 * a bare id and one of them was already lost, and choosing which document to
 * destroy is not this script's call.
 *
 * Idempotent: a key that already contains the chat-id prefix is skipped.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-telegram-message-keys.mjs            (apply)
 *   node --env-file=.env scripts/migrate-telegram-message-keys.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

function scopedKey(chatId, providerMessageId) {
  return `${chatId}:${providerMessageId}`;
}

/** Already migrated when the value carries its conversation's chat prefix. */
function alreadyScoped(chatId, providerMessageId) {
  return String(providerMessageId).startsWith(`${chatId}:`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`${DRY_RUN ? "[dry-run] " : ""}connected to ${db.databaseName}`);

  const conversations = db.collection("conversations");
  const messages = db.collection("conversationmessages");
  const outbox = db.collection("messageoutboxes");

  // chatId per Telegram conversation, so each message can be scoped locally.
  const chatIdByConversation = new Map();
  const cursor = conversations.find(
    { channel: "telegram", externalThreadId: { $type: "string" } },
    { projection: { externalThreadId: 1 } },
  );
  for await (const conversation of cursor) {
    chatIdByConversation.set(
      String(conversation._id),
      conversation.externalThreadId,
    );
  }
  console.log(`telegram conversations: ${chatIdByConversation.size}`);

  const stats = {
    scanned: 0,
    migrated: 0,
    alreadyScoped: 0,
    noConversation: 0,
    collisions: 0,
    outboxMigrated: 0,
  };
  const collisions = [];

  const messageCursor = messages.find(
    { channel: "telegram", providerMessageId: { $type: "string" } },
    { projection: { providerMessageId: 1, conversationId: 1 } },
  );

  for await (const message of messageCursor) {
    stats.scanned += 1;
    const chatId = chatIdByConversation.get(String(message.conversationId));
    if (!chatId) {
      stats.noConversation += 1;
      continue;
    }
    if (alreadyScoped(chatId, message.providerMessageId)) {
      stats.alreadyScoped += 1;
      continue;
    }
    const next = scopedKey(chatId, message.providerMessageId);

    const clash = await messages.findOne(
      { channel: "telegram", providerMessageId: next, _id: { $ne: message._id } },
      { projection: { _id: 1 } },
    );
    if (clash) {
      stats.collisions += 1;
      collisions.push({
        message: String(message._id),
        conflictsWith: String(clash._id),
        key: next,
      });
      continue;
    }

    if (!DRY_RUN) {
      await messages.updateOne(
        { _id: message._id },
        { $set: { providerMessageId: next } },
      );
      // The outbox mirrors the provider id for delivered rows; keep them in step
      // so the failed-delivery dashboard still resolves to the same message.
      const result = await outbox.updateOne(
        {
          messageId: message._id,
          provider: "telegram",
          providerMessageId: message.providerMessageId,
        },
        { $set: { providerMessageId: next } },
      );
      stats.outboxMigrated += result.modifiedCount || 0;
    }
    stats.migrated += 1;
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}scanned=${stats.scanned} migrated=${stats.migrated} ` +
      `alreadyScoped=${stats.alreadyScoped} orphaned=${stats.noConversation} ` +
      `outboxRows=${stats.outboxMigrated} collisions=${stats.collisions}`,
  );
  if (collisions.length) {
    console.log(
      "\nLeft untouched — two chats already shared this bare id, so one side's " +
        "history was lost before this fix. Review manually:",
    );
    for (const entry of collisions.slice(0, 50)) {
      console.log(`  ${entry.message} collides with ${entry.conflictsWith} at ${entry.key}`);
    }
    if (collisions.length > 50) {
      console.log(`  … and ${collisions.length - 50} more`);
    }
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Telegram message-key migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
