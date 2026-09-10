import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireConversationViewer } from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import {
  connectMetaChannel,
  connectTelegramChannel,
  disconnectChannel,
  listChannelConnections,
  updateChannelSettings,
  verifyConnectedChannel,
} from "@/lib/conversations/providers/connections";
import { revalidateProductContent } from "@/lib/cache-invalidation";

const ConnectSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("whatsapp"),
    accessToken: z.string().min(20).max(5000),
    phoneNumberId: z.string().trim().min(1).max(300),
    businessAccountId: z.string().trim().min(1).max(300),
    publicPhoneNumberE164: z.string().trim().max(40).optional(),
    externalAccountId: z.string().trim().max(300).optional(),
    displayName: z.string().trim().max(160).optional(),
    tokenExpiresAt: z.string().datetime().optional(),
    scopes: z.array(z.string().max(200)).max(30).optional(),
  }),
  z.object({
    provider: z.literal("messenger"),
    accessToken: z.string().min(20).max(5000),
    pageId: z.string().trim().min(1).max(300),
    publicPageUsername: z.string().trim().max(120).optional(),
    messengerHumanAgentEnabled: z.boolean().optional(),
    externalAccountId: z.string().trim().max(300).optional(),
    displayName: z.string().trim().max(160).optional(),
    tokenExpiresAt: z.string().datetime().optional(),
    scopes: z.array(z.string().max(200)).max(30).optional(),
  }),
  z.object({
    provider: z.literal("telegram"),
    // The BotFather token is the entire credential: no OAuth, no app review.
    botToken: z.string().trim().min(20).max(200),
    publicTelegramUsername: z.string().trim().max(120).optional(),
    displayName: z.string().trim().max(160).optional(),
  }),
  z.object({
    provider: z.literal("instagram"),
    // Instagram Direct is served through the linked Facebook Page, so the
    // credential is that Page's access token and the identity is the Instagram
    // professional account it manages.
    accessToken: z.string().min(20).max(5000),
    instagramUserId: z.string().trim().min(1).max(300),
    publicInstagramUsername: z.string().trim().max(120).optional(),
    messengerHumanAgentEnabled: z.boolean().optional(),
    externalAccountId: z.string().trim().max(300).optional(),
    displayName: z.string().trim().max(160).optional(),
    tokenExpiresAt: z.string().datetime().optional(),
    scopes: z.array(z.string().max(200)).max(30).optional(),
  }),
]);

const DisconnectSchema = z.object({
  connectionId: z.string().trim().min(1),
});

/**
 * PATCH does double duty: with `messengerHumanAgentEnabled` it changes that
 * setting on a live connection, without it it re-verifies the credential.
 */
const UpdateSchema = z.object({
  connectionId: z.string().trim().min(1),
  messengerHumanAgentEnabled: z.boolean().optional(),
});

export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "chat:channels:list",
    "lenient",
    session.user.role,
  );
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );
  return successResponse({
    connections: await listChannelConnections(viewer),
    webhookUrl: `${request.nextUrl.origin}/api/webhooks/meta`,
  });
});

export const POST = withApi({ auth: "user" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "chat:channels:connect",
    "strict",
    session.user.role,
  );
  const body = await validateBody(request, ConnectSchema);
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );
  const connection =
    body.provider === "telegram"
      ? await connectTelegramChannel({
          viewer,
          botToken: body.botToken,
          publicTelegramUsername: body.publicTelegramUsername,
          displayName: body.displayName,
          // Telegram pushes to whatever absolute URL we register, so it is
          // derived from the request rather than configured separately.
          webhookUrl: `${request.nextUrl.origin}/api/webhooks/telegram`,
        })
      : await connectMetaChannel({ viewer, ...body });
  if (viewer.kind === "admin") revalidateProductContent();
  return successResponse({ connection });
});

export const PATCH = withApi({ auth: "user" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "chat:channels:verify",
    "strict",
    session.user.role,
  );
  const body = await validateBody(request, UpdateSchema);
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );
  return successResponse({
    connection:
      body.messengerHumanAgentEnabled === undefined
        ? await verifyConnectedChannel({
            viewer,
            connectionId: body.connectionId,
          })
        : await updateChannelSettings({
            viewer,
            connectionId: body.connectionId,
            messengerHumanAgentEnabled: body.messengerHumanAgentEnabled,
          }),
  });
});

// Shopper-owned data: disconnecting your own channel stays available on demo.
export const DELETE = withApi({ auth: "user", demo: "allow" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "chat:channels:disconnect",
    "strict",
    session.user.role,
  );
  const body = await validateBody(request, DisconnectSchema);
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );
  await disconnectChannel({ viewer, connectionId: body.connectionId });
  if (viewer.kind === "admin") revalidateProductContent();
  return successResponse({ disconnected: true });
});
