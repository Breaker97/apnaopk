import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  computeEtag,
  matchesIfNoneMatch,
  notModifiedResponse,
} from "@/lib/api/etag";
import {
  countUnreadConversationMessages,
  requireConversationViewer,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/conversations/unread
 *
 * The unread-message count on the dashboard sidebar's Inbox entry, polled by
 * `useInboxUnreadCount` from every open dashboard page.
 *
 * The count IS the version: one indexed aggregate decides both, so the ETag
 * saves the payload and the sidebar re-render rather than a query. Tagged over
 * the viewer too, so two viewers with the same count never share a tag.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );
  const unreadMessages = await countUnreadConversationMessages({ viewer });

  const etag = computeEtag({
    viewer: `${viewer.kind}:${session.user.id}`,
    unreadMessages,
  });
  if (matchesIfNoneMatch(request, etag)) {
    return notModifiedResponse(etag);
  }

  const response = successResponse({ unreadMessages });
  response.headers.set("ETag", etag);
  return response;
});
