import { getSettings } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { runAISalesAgent } from "@/lib/ai-sales-agent/engine";
import {
  isOpenAIConfigured,
  normalizeAISalesAgentSettings,
  toPublicAISalesAgentConfig,
} from "@/lib/ai-sales-agent/settings";
import type { AISalesStreamEvent } from "@/lib/ai-sales-agent/types";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

const AgentChatSchema = z.object({
  conversationId: z.string().max(100).optional(),
  message: z.string().max(4000).optional(),
  locale: z.string().max(10).optional(),
});

/** Thirty days — the storefront cart cookie's own lifetime. */
const CART_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * POST /api/ai-sales-agent/chat
 *
 * The reply streams as newline-delimited JSON (`AISalesStreamEvent` per
 * line): the cards the moment the tools return, the text as the model writes
 * it, then a `done` line carrying the persisted message. Validation, rate
 * limiting and configuration errors are thrown before the stream opens and
 * arrive as the usual JSON error; anything that fails after the headers are
 * sent becomes an `error` line instead.
 */
export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cookieCartSession = request.cookies.get("cart_session")?.value;
    const body = await validateBody(request, AgentChatSchema);

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new ValidationError("Message is required");
    if (message.length > 1200) throw new ValidationError("Message is too long");

    const userId = session?.user?.id;
    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "ai-sales-agent:chat",
        "moderate",
        session.user.role,
      );
    } else if (cookieCartSession) {
      await rateLimitBySession(
        request,
        cookieCartSession,
        "ai-sales-agent:chat",
        "moderate",
      );
    } else {
      await rateLimitByIP(request, "moderate");
    }

    const settings = await getSettings();
    const aiSettings = normalizeAISalesAgentSettings(settings.aiSalesAgent);
    if (!aiSettings.enabled) throw new ValidationError("AI Sales Agent is disabled");
    if (!isOpenAIConfigured(settings.aiAuthoring)) {
      throw new ValidationError("OpenAI API key is not configured");
    }

    const locale =
      typeof body.locale === "string" && body.locale.trim()
        ? body.locale.trim()
        : "en";
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    // A streamed response has sent its headers before the agent knows whether
    // it put anything in a cart, so the guest cookie cannot wait for that. A
    // guest who may add to the cart gets their cart session minted now — the
    // same cookie the cart API would set on the first add, one message early.
    let cartSessionId = cookieCartSession;
    let mintedCartSession: string | undefined;
    if (!userId && !cartSessionId && aiSettings.capabilities.cartActions) {
      cartSessionId = crypto.randomUUID();
      mintedCartSession = cartSessionId;
    }

    const publicConfig = toPublicAISalesAgentConfig(aiSettings, {
      aiAuthoring: settings.aiAuthoring,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (event: AISalesStreamEvent) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // The client went away; the run still completes and persists.
            open = false;
          }
        };
        try {
          const result = await runAISalesAgent({
            conversationId: body.conversationId,
            userMessage: message,
            ctx: {
              locale,
              userId,
              userEmail: session?.user?.email,
              sessionId: cartSessionId,
              origin,
              settings: aiSettings,
            },
            onEvent: send,
          });
          send({
            type: "done",
            conversationId: result.conversationId,
            message: result.message,
            cartUpdated: result.cartUpdated,
            checkoutUrl: result.checkoutUrl,
            settings: publicConfig,
          });
        } catch (error) {
          console.error("[ai-sales-agent] chat failed", error);
          send({
            type: "error",
            message: "The assistant could not answer right now. Please try again.",
          });
        } finally {
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed by the consumer.
          }
        }
      },
    });

    const response = new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        // Proxies must not buffer a reply that is meant to arrive as it forms.
        "X-Accel-Buffering": "no",
      },
    });
    if (mintedCartSession) {
      response.headers.set(
        "Set-Cookie",
        `cart_session=${mintedCartSession}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CART_SESSION_MAX_AGE}`,
      );
    }
    return response;
  },
);
