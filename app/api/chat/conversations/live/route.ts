import { Types } from "mongoose";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  computeEtag,
  matchesIfNoneMatch,
  notModifiedResponse,
} from "@/lib/api/etag";
import {
  CONVERSATION_LIMIT,
  CREATED_POLL_LIMIT,
  STATUS_POLL_LIMIT,
  STATUS_REPLAY_MS,
  nextStatusWatermark,
} from "@/lib/conversations/live-feed";
import {
  getConversationFeedVersion,
  listConversations,
  requireConversationViewer,
  serializeConversationMessage,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import { ConversationMessage } from "@/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/conversations/live
 *
 * One tick of the inbox feed: the newest conversation page, messages created
 * after `cursor`, and delivery-status changes at or after `statusSince`.
 *
 * This replaces the SSE stream that used to hold a function open per connected
 * agent and poll Mongo every 2.5s. The stream's per-connection state was only
 * ever three values — a message cursor, a status watermark, and the last
 * conversation signature — so none of it needed a connection to live in. The
 * client carries the first two in the query string and gets them back
 * advanced; the third is what the ETag compares. The server keeps nothing.
 *
 * Most ticks find nothing new, so the shape is validator-first, the same as
 * GET /api/notifications: `getConversationFeedVersion` decides in three light
 * reads whether the five heavy ones are worth running, and a poll that finds
 * nothing costs neither the two populates in `listConversations` nor the up-to
 * 600 message documents a tick can read.
 *
 * The tag is over that version and the *incoming* cursor/watermark, not over
 * the payload. Both are needed: the version alone would tell a client whose
 * cursor has moved that nothing changed, about a payload it never held.
 *
 * A message that lands between the validator and the reads below ships in this
 * payload under a tag that predates it. That resolves itself rather than losing
 * anything: the next tick sees the newer version, so it cannot match, and the
 * 200 it gets carries no duplicate — the cursor has already moved past the row.
 */

function parseCursor(value: string | null): Types.ObjectId {
  if (value && Types.ObjectId.isValid(value)) return new Types.ObjectId(value);
  // A client with no cursor replays a few seconds, which closes the race
  // between its initial REST fetch and its first tick here.
  return Types.ObjectId.createFromTime(
    Math.max(0, Math.floor(Date.now() / 1000) - 5),
  );
}

function parseStatusSince(value: string | null): Date {
  const parsed = value ? new Date(value) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  return new Date(Date.now() - STATUS_REPLAY_MS);
}

export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );

  const searchParams = request.nextUrl.searchParams;
  const cursor = parseCursor(searchParams.get("cursor"));
  const statusSince = parseStatusSince(searchParams.get("statusSince"));

  // Normalized rather than raw, so a client that omits either one is compared
  // against the same defaults the payload would have been built from.
  const version = await getConversationFeedVersion({
    viewer,
    limit: CONVERSATION_LIMIT,
  });
  const etag = computeEtag({
    ...version,
    cursor: String(cursor),
    statusSince: statusSince.toISOString(),
  });

  if (matchesIfNoneMatch(request, etag)) {
    return notModifiedResponse(etag);
  }

  const { conversations } = await listConversations({
    viewer,
    limit: CONVERSATION_LIMIT,
  });

  // Scope message reads to exactly the threads this page carries. Deriving the
  // ids from an already-bounded result is what keeps an admin viewer from
  // materialising the entire conversations collection on every tick.
  const conversationIds = conversations.map(
    (conversation) => new Types.ObjectId(conversation._id),
  );

  let nextCursor = cursor;
  let createdMessages: ReturnType<typeof serializeConversationMessage>[] = [];
  let updatedMessages: ReturnType<typeof serializeConversationMessage>[] = [];
  let nextStatusSince = statusSince;

  if (conversationIds.length > 0) {
    const created = await ConversationMessage.find({
      conversationId: { $in: conversationIds },
      _id: { $gt: cursor },
    })
      .sort({ _id: 1 })
      .limit(CREATED_POLL_LIMIT)
      .lean();

    createdMessages = created.map(serializeConversationMessage);
    const newestCreated = created[created.length - 1];
    if (newestCreated) nextCursor = newestCreated._id as Types.ObjectId;

    const recentlyUpdated = await ConversationMessage.find({
      conversationId: { $in: conversationIds },
      $expr: { $gt: ["$updatedAt", "$createdAt"] },
      updatedAt: { $gte: statusSince },
    })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(STATUS_POLL_LIMIT)
      .lean();

    updatedMessages = recentlyUpdated.map(serializeConversationMessage);

    nextStatusSince = new Date(
      nextStatusWatermark({
        statusSince: statusSince.getTime(),
        updatedAts: recentlyUpdated.map((message) =>
          new Date(message.updatedAt).getTime(),
        ),
        limit: STATUS_POLL_LIMIT,
      }),
    );
  }

  const response = successResponse({
    conversations,
    createdMessages,
    updatedMessages,
    cursor: String(nextCursor),
    statusSince: nextStatusSince.toISOString(),
  });
  response.headers.set("ETag", etag);
  return response;
});
