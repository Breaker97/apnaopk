import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import {
  createMetaOnboardingState,
  verifyMetaOnboardingState,
} from "@/lib/conversations/secret-box";
import {
  completeInstagramEmbeddedSignup,
  completeWhatsAppEmbeddedSignup,
} from "@/lib/conversations/providers/meta-client";
import { connectMetaChannel } from "@/lib/conversations/providers/connections";
import { requireConversationViewer } from "@/lib/conversations/service";
import {
  assertVendorChannelPermission,
  resolveConversationViewer,
} from "@/lib/conversations/viewer";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { revalidateProductContent } from "@/lib/cache-invalidation";

const CompleteSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("whatsapp"),
    code: z.string().trim().min(10).max(5000),
    state: z.string().trim().min(20).max(5000),
    businessAccountId: z.string().trim().min(1).max(300),
    phoneNumberId: z.string().trim().min(1).max(300),
  }),
  z.object({
    provider: z.literal("instagram"),
    code: z.string().trim().min(10).max(5000),
    state: z.string().trim().min(20).max(5000),
    // Only needed when the admin manages more than one eligible Page.
    pageId: z.string().trim().max(300).optional(),
  }),
]);

function assertChannelManager(
  viewer: NonNullable<
    Awaited<ReturnType<typeof resolveConversationViewer>>
  >,
) {
  if (viewer.kind === "admin") return;
  if (viewer.kind === "vendor") {
    assertVendorChannelPermission(viewer);
    return;
  }
  throw new AuthorizationError("Messaging-channel permission is required");
}

export const GET = withApi(
  {
    auth: "user",
    rateLimit: {
      action: "chat:embedded-signup:config",
      preset: "lenient",
    },
  },
  async ({ session }) => {
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    assertChannelManager(viewer);
    const appId = process.env.META_APP_ID?.trim() || "";
    const graphVersion = process.env.META_GRAPH_API_VERSION?.trim() || "";
    const baseReady = Boolean(
      appId &&
        /^v\d+\.\d+$/.test(graphVersion) &&
        process.env.META_APP_SECRET?.trim(),
    );
    // Each provider has its own Facebook Login for Business configuration, so
    // one can be set up while the other is not.
    const configurationIds = {
      whatsapp: process.env.META_WHATSAPP_CONFIGURATION_ID?.trim() || "",
      instagram: process.env.META_INSTAGRAM_CONFIGURATION_ID?.trim() || "",
    };
    const configured = baseReady && Boolean(configurationIds.whatsapp);
    return successResponse({
      // Kept for the existing WhatsApp button's contract.
      configured,
      appId,
      configurationId: configurationIds.whatsapp,
      graphVersion,
      providers: {
        whatsapp: {
          configured,
          configurationId: configurationIds.whatsapp,
        },
        instagram: {
          configured: baseReady && Boolean(configurationIds.instagram),
          configurationId: configurationIds.instagram,
        },
      },
      state: baseReady ? createMetaOnboardingState(session.user.id) : undefined,
    });
  },
);

export const POST = withApi(
  {
    auth: "user",
    rateLimit: {
      action: "chat:embedded-signup:complete",
      preset: "strict",
    },
  },
  async ({ request, session }) => {
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    assertChannelManager(viewer);
    const body = await validateBody(request, CompleteSchema);
    if (!verifyMetaOnboardingState(body.state, session.user.id)) {
      throw new ValidationError("Embedded Signup session is invalid or expired");
    }
    if (body.provider === "instagram") {
      const signup = await completeInstagramEmbeddedSignup({
        code: body.code,
        pageId: body.pageId,
      });
      const connection = await connectMetaChannel({
        viewer,
        provider: "instagram",
        ...signup,
        scopes: [
          "instagram_basic",
          "instagram_manage_messages",
          "pages_manage_metadata",
          "pages_messaging",
        ],
      });
      if (viewer.kind === "admin") revalidateProductContent();
      return successResponse({ connection }, "Instagram connected");
    }
    const signup = await completeWhatsAppEmbeddedSignup(body);
    const connection = await connectMetaChannel({
      viewer,
      provider: "whatsapp",
      ...signup,
      scopes: [
        "whatsapp_business_management",
        "whatsapp_business_messaging",
      ],
    });
    if (viewer.kind === "admin") revalidateProductContent();
    return successResponse(
      { connection },
      "WhatsApp Embedded Signup completed",
    );
  },
);
