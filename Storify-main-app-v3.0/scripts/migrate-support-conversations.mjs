import mongoose from "mongoose";

const DRY_RUN = process.argv.includes("--dry-run");

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function status(value) {
  if (value === "closed") return "closed";
  if (value === "replied") return "pending";
  return "open";
}

function senderType(value) {
  return ["customer", "guest", "vendor", "staff", "admin"].includes(value)
    ? value
    : "guest";
}

async function ensureContact(db, support, existingConversation) {
  const contacts = db.collection("conversationcontacts");
  if (existingConversation?.contactId) return existingConversation.contactId;
  const sender = support.sender || {};
  const now = new Date();
  if (sender.userId) {
    const result = await contacts.findOneAndUpdate(
      { userId: sender.userId },
      {
        $setOnInsert: {
          userId: sender.userId,
          name: text(sender.name, 120) || "Customer",
          email: text(sender.email, 320).toLowerCase() || undefined,
          phone: text(sender.phone, 40) || undefined,
          image: text(sender.image, 2000) || undefined,
          channelIdentities: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    return result._id;
  }

  const externalId = `legacy-support:${support._id}`;
  const existing = await contacts.findOne({
    channelIdentities: {
      $elemMatch: { channel: "live_chat", externalId },
    },
  });
  if (existing) return existing._id;
  const contactId = new mongoose.Types.ObjectId();
  await contacts.insertOne({
    _id: contactId,
    name: text(sender.name, 120) || "Guest",
    email: text(sender.email, 320).toLowerCase() || undefined,
    phone: text(sender.phone, 40) || undefined,
    image: text(sender.image, 2000) || undefined,
    channelIdentities: [
      {
        channel: "live_chat",
        externalId,
        displayValue: text(sender.email, 320) || undefined,
        verifiedAt: support.createdAt || now,
      },
    ],
    createdAt: support.createdAt || now,
    updatedAt: support.updatedAt || now,
  });
  return contactId;
}

async function migrateConversation(db, support) {
  const conversations = db.collection("conversations");
  const messages = db.collection("conversationmessages");
  const participants = db.collection("conversationparticipants");
  const existing = await conversations.findOne({
    legacySource: "support",
    legacyConversationId: support._id,
  });
  const contactId = await ensureContact(db, support, existing);
  const conversationId = existing?._id || new mongoose.Types.ObjectId();
  const entries = Array.isArray(support.messages) ? support.messages : [];
  const firstAt = entries[0]?.createdAt || support.createdAt || new Date();
  const lastEntry = entries.at(-1);
  const lastAt =
    support.lastMessageAt || lastEntry?.createdAt || support.updatedAt || firstAt;
  const lastInbound = [...entries]
    .reverse()
    .find((entry) => entry.senderType !== "admin")?.createdAt;
  const lastOutbound = [...entries]
    .reverse()
    .find((entry) => entry.senderType === "admin")?.createdAt;
  const lastMessageId = lastEntry?._id || undefined;
  const sender = support.sender || {};
  const mappedStatus = status(support.status);

  // Everything the legacy record contributes is insert-only. A rerun must be a
  // no-op for a thread that already migrated: the previous version `$set` the
  // header on every run, so re-running the migration reverted status, unread
  // counters and the last-message snapshot to their legacy values and undid
  // whatever agents had done in the new inbox since the first import.
  await conversations.updateOne(
    { _id: conversationId },
    {
      $setOnInsert: {
        channel: "live_chat",
        ownerType: "platform",
        contactId,
        customerUserId:
          sender.type === "customer" ? sender.userId || undefined : undefined,
        contact: {
          name: text(sender.name, 120) || "Customer",
          email: text(sender.email, 320).toLowerCase() || undefined,
          phone: text(sender.phone, 40) || undefined,
          image: text(sender.image, 2000) || undefined,
        },
        subject: text(support.subject, 180) || "Support request",
        status: mappedStatus,
        legacySource: "support",
        legacyConversationId: support._id,
        lastMessageId,
        lastMessagePreview:
          text(support.lastMessagePreview || lastEntry?.body, 240) || "Message",
        lastMessageAt: lastAt,
        lastInboundAt: lastInbound,
        lastOutboundAt: lastOutbound,
        unreadForCustomer: support.status === "replied" ? 1 : 0,
        unreadForStore: support.status === "open" ? 1 : 0,
        createdAt: support.createdAt || firstAt,
        updatedAt: support.updatedAt || lastAt,
      },
    },
    { upsert: true },
  );

  for (const entry of entries) {
    const messageId = entry._id || new mongoose.Types.ObjectId();
    const type = senderType(entry.senderType);
    await messages.updateOne(
      { _id: messageId },
      {
        $setOnInsert: {
          _id: messageId,
          conversationId,
          channel: "live_chat",
          direction: type === "admin" ? "outbound" : "inbound",
          senderType: type,
          senderUserId: entry.senderUserId || undefined,
          senderName: text(entry.senderName, 120) || "User",
          body: text(entry.body, 4000),
          attachments: [],
          providerMetadata: {
            kind: "legacy_support",
            legacyConversationId: String(support._id),
            legacyMessageId: String(messageId),
          },
          deliveryStatus: "sent",
          createdAt: entry.createdAt || firstAt,
          updatedAt: entry.createdAt || firstAt,
        },
      },
      { upsert: true },
    );
  }

  if (sender.type === "customer" && sender.userId) {
    await participants.updateOne(
      { conversationId, userId: sender.userId },
      {
        $set: {
          side: "customer",
          participantType: "customer",
          notificationMuted: false,
          updatedAt: support.updatedAt || lastAt,
        },
        $setOnInsert: {
          conversationId,
          userId: sender.userId,
          createdAt: support.createdAt || firstAt,
        },
      },
      { upsert: true },
    );
  }
  return Boolean(existing);
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
  const supportCollection = db.collection("supportconversations");
  const supportCount = await supportCollection.countDocuments();
  if (DRY_RUN) {
    const alreadyMigrated = await db
      .collection("conversations")
      .countDocuments({ legacySource: "support" });
    console.log(
      `[dry-run] ${supportCount} legacy support conversations found; ${alreadyMigrated} already migrated`,
    );
    return;
  }

  let created = 0;
  let refreshed = 0;
  const cursor = supportCollection.find({}).sort({ _id: 1 });
  for await (const support of cursor) {
    const existed = await migrateConversation(db, support);
    if (existed) refreshed += 1;
    else created += 1;
  }
  console.log(
    `Migrated ${created} support conversations; refreshed ${refreshed} existing migrations`,
  );
}

try {
  await run();
} finally {
  await mongoose.disconnect();
}
