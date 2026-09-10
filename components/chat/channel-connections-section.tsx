import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { listChannelConnections } from "@/lib/conversations/providers/connections";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import { ChannelConnectionsPanel } from "@/components/chat/channel-connections-panel";

/**
 * Reads the channel connections on the server and hands them to the panel.
 *
 * The panel used to mount empty, fire `GET /api/chat/channels` from the browser
 * and show a spinner over the whole card until it answered — a round trip that
 * only started after hydration, to fetch data the server already had. Resolving
 * it here means the connected channels are in the first HTML the browser sees.
 *
 * Suspended by the page rather than awaited inline, so the settings header and
 * the live-chat panel above it paint without waiting on this query.
 */
export async function ChannelConnectionsSection() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  await connectDB();
  const viewer = await resolveConversationViewer({ session });
  // The route guard has already refused non-admins; a viewer that cannot manage
  // channels gets the panel's own refusal rather than a thrown page.
  if (!viewer || (viewer.kind !== "admin" && viewer.kind !== "vendor")) {
    return <ChannelConnectionsPanel canManage={false} />;
  }

  const connections = await listChannelConnections(viewer);
  // Mirrors what `GET /api/chat/channels` derives from the request, so the value
  // an admin copies is the origin they are actually browsing.
  const host = requestHeaders.get("host") ?? "";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return (
    <ChannelConnectionsPanel
      canManage
      initialConnections={connections}
      initialWebhookUrl={host ? `${protocol}://${host}/api/webhooks/meta` : ""}
    />
  );
}
