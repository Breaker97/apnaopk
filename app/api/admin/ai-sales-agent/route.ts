import { connectDB } from "@/lib/db";
import { AISalesConversation, Settings, getSettings } from "@/models";
import type { IAISalesAgentSettings } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  isOpenAIConfigured,
  normalizeAISalesAgentSettings,
} from "@/lib/ai-sales-agent/settings";
import {
  getAISalesUsage,
  isTokenBudgetExhausted,
} from "@/lib/ai-sales-agent/usage";
import {
  AI_SALES_AGENT_MODEL_IDS,
  AI_SALES_AGENT_REASONING_EFFORTS,
  AI_SALES_AGENT_TONES,
} from "@/lib/ai-sales-agent/models";
import { revalidateSettingsContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { isPlainObject } from "@/lib/utils";

const ALLOWED_MODELS = new Set<string>(AI_SALES_AGENT_MODEL_IDS);
const ALLOWED_TONES = new Set<string>(AI_SALES_AGENT_TONES);
const ALLOWED_REASONING = new Set<string>(AI_SALES_AGENT_REASONING_EFFORTS);

function sanitizeUpdate(data: unknown) {
  if (!isPlainObject(data)) throw new ValidationError("Invalid AI settings payload");
  const next: Record<string, unknown> = {};
  const copyString = (key: string, max: number) => {
    if (data[key] === undefined) return;
    if (typeof data[key] !== "string") throw new ValidationError(`Invalid ${key}`);
    next[key] = (data[key] as string).slice(0, max);
  };

  if (data.enabled !== undefined) next.enabled = Boolean(data.enabled);
  if (data.model !== undefined) {
    if (typeof data.model !== "string" || !ALLOWED_MODELS.has(data.model)) {
      throw new ValidationError("Invalid model");
    }
    next.model = data.model;
  }
  if (data.temperature !== undefined) {
    const value = Number(data.temperature);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new ValidationError("Invalid temperature");
    }
    next.temperature = value;
  }
  if (data.reasoningEffort !== undefined) {
    if (
      typeof data.reasoningEffort !== "string" ||
      !ALLOWED_REASONING.has(data.reasoningEffort)
    ) {
      throw new ValidationError("Invalid reasoning effort");
    }
    next.reasoningEffort = data.reasoningEffort;
  }
  if (data.maxRecommendations !== undefined) {
    const value = Number(data.maxRecommendations);
    if (!Number.isFinite(value) || value < 1 || value > 8) {
      throw new ValidationError("Invalid recommendation limit");
    }
    next.maxRecommendations = Math.round(value);
  }
  if (data.monthlyTokenBudget !== undefined) {
    const value = Number(data.monthlyTokenBudget);
    if (!Number.isFinite(value) || value < 0 || value > 1e12) {
      throw new ValidationError("Invalid monthly token budget");
    }
    next.monthlyTokenBudget = Math.floor(value);
  }
  if (data.tone !== undefined) {
    if (typeof data.tone !== "string" || !ALLOWED_TONES.has(data.tone)) {
      throw new ValidationError("Invalid tone");
    }
    next.tone = data.tone;
  }
  copyString("agentName", 80);
  copyString("greeting", 500);
  copyString("instructions", 3000);
  copyString("escalationMessage", 500);

  if (isPlainObject(data.widget)) {
    const clamp = (raw: unknown, min: number, max: number, fallback: number) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return fallback;
      return Math.round(Math.min(Math.max(value, min), max));
    };
    next.widget = {
      position:
        data.widget.position === "bottom-left" ? "bottom-left" : "bottom-right",
      primaryColor:
        typeof data.widget.primaryColor === "string"
          ? data.widget.primaryColor.slice(0, 40)
          : "#7c3aed",
      accentColor:
        typeof data.widget.accentColor === "string"
          ? data.widget.accentColor.slice(0, 40)
          : "#a855f7",
      avatarUrl:
        typeof data.widget.avatarUrl === "string"
          ? data.widget.avatarUrl.slice(0, 500)
          : "",
      footerText:
        typeof data.widget.footerText === "string"
          ? data.widget.footerText.slice(0, 120)
          : "Powered by AI",
      headerTitle:
        typeof data.widget.headerTitle === "string"
          ? data.widget.headerTitle.slice(0, 60)
          : "",
      width: clamp(data.widget.width, 320, 640, 400),
      height: clamp(data.widget.height, 420, 900, 680),
      showFooterText:
        data.widget.showFooterText === undefined
          ? true
          : Boolean(data.widget.showFooterText),
    };
  }

  if (isPlainObject(data.capabilities)) {
    next.capabilities = {
      productQA: Boolean(data.capabilities.productQA),
      recommendations: Boolean(data.capabilities.recommendations),
      cartActions: Boolean(data.capabilities.cartActions),
      checkoutHandoff: Boolean(data.capabilities.checkoutHandoff),
      orderStatus: Boolean(data.capabilities.orderStatus),
    };
  }

  if (Array.isArray(data.faq)) {
    const MAX_ENTRIES = 50;
    next.faq = data.faq
      .slice(0, MAX_ENTRIES)
      .map((raw) => (isPlainObject(raw) ? raw : null))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => ({
        question:
          typeof entry.question === "string" ? entry.question.slice(0, 300) : "",
        answer:
          typeof entry.answer === "string" ? entry.answer.slice(0, 2000) : "",
        tags: Array.isArray(entry.tags)
          ? entry.tags
              .filter((tag): tag is string => typeof tag === "string")
              .map((tag) => tag.trim().slice(0, 40))
              .filter(Boolean)
              .slice(0, 10)
          : [],
      }))
      .filter((entry) => entry.question.trim() && entry.answer.trim());
  }

  return next;
}

type ConversationSummaryDoc = {
  _id: unknown;
  sessionId?: string;
  userId?: unknown;
  locale?: string;
  status?: string;
  messages?: Array<{ content?: string }>;
  actions?: unknown[];
  lastMessageAt?: Date;
  updatedAt?: Date;
};

export const GET = withApi(
  { auth: "admin" },
  async () => {
    const settings = await getSettings();

    const now = new Date();
    const last7Days = new Date(now);
    last7Days.setDate(last7Days.getDate() - 7);
    const last30Days = new Date(now);
    last30Days.setDate(last30Days.getDate() - 30);

    const [
      conversations,
      totals,
      recent7Count,
      recent30Count,
      activeCount,
      usage,
    ] = await Promise.all([
      AISalesConversation.find({})
        .sort({ updatedAt: -1 })
        .limit(10)
        .select(
          "sessionId userId locale status messages actions cartItemCount updatedAt lastMessageAt",
        )
        .lean(),
      AISalesConversation.aggregate([
        {
          $group: {
            _id: null,
            totalConversations: { $sum: 1 },
            totalMessages: { $sum: { $size: { $ifNull: ["$messages", []] } } },
            totalActions: { $sum: { $size: { $ifNull: ["$actions", []] } } },
          },
        },
      ]),
      AISalesConversation.countDocuments({
        lastMessageAt: { $gte: last7Days },
      }),
      AISalesConversation.countDocuments({
        lastMessageAt: { $gte: last30Days },
      }),
      AISalesConversation.countDocuments({ status: "active" }),
      getAISalesUsage(),
    ]);
    const aiSettings = normalizeAISalesAgentSettings(settings.aiSalesAgent);

    const stats = (totals[0] as
      | { totalConversations: number; totalMessages: number; totalActions: number }
      | undefined) || {
      totalConversations: 0,
      totalMessages: 0,
      totalActions: 0,
    };

    return successResponse({
      settings: aiSettings,
      configured: isOpenAIConfigured(settings.aiAuthoring),
      faviconUrl: settings.general?.faviconUrl || "",
      // This month's spend against the budget, so the page can say where the
      // store stands before the widget goes quiet.
      usage: {
        ...usage,
        budget: aiSettings.monthlyTokenBudget,
        exhausted: isTokenBudgetExhausted(
          aiSettings.monthlyTokenBudget,
          usage.totalTokens,
        ),
      },
      stats: {
        totalConversations: stats.totalConversations,
        totalMessages: stats.totalMessages,
        totalActions: stats.totalActions,
        activeConversations: activeCount,
        conversationsLast7Days: recent7Count,
        conversationsLast30Days: recent30Count,
      },
      conversations: (conversations as ConversationSummaryDoc[]).map((conversation) => ({
        id: String(conversation._id),
        sessionId: conversation.sessionId,
        userId: conversation.userId ? String(conversation.userId) : undefined,
        locale: conversation.locale,
        status: conversation.status,
        lastMessage:
          conversation.messages?.[conversation.messages.length - 1]?.content || "",
        messageCount: conversation.messages?.length || 0,
        actionCount: conversation.actions?.length || 0,
        lastMessageAt: conversation.lastMessageAt,
        updatedAt: conversation.updatedAt,
      })),
    });
  },
);

export const PUT = withApi(
  // This writes the sales-agent configuration, i.e. settings.
  { auth: "admin", demo: "block-mutations" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:ai-sales-agent:update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const body = (await request.json()) as unknown;
    const data = isPlainObject(body) && "settings" in body ? body.settings : body;
    const update = sanitizeUpdate(data);

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings({});
    const current = normalizeAISalesAgentSettings(settings.aiSalesAgent);
    const merged = {
      ...current,
      ...update,
      widget: {
        ...current.widget,
        ...(isPlainObject(update.widget) ? update.widget : {}),
      },
      capabilities: {
        ...current.capabilities,
        ...(isPlainObject(update.capabilities) ? update.capabilities : {}),
      },
    };
    settings.set("aiSalesAgent", merged);
    settings.markModified("aiSalesAgent");
    settings.updatedBy = session.user.id;
    await settings.save();
    // Storefront caches (settings tag) serve the AI widget config — without
    // this, widget changes lag up to the cache revalidate window.
    revalidateSettingsContent();

    const fresh = await Settings.findById(settings._id).lean<{
      aiSalesAgent?: Partial<IAISalesAgentSettings>;
      aiAuthoring?: { apiKey?: string };
    } | null>();

    return successResponse({
      settings: normalizeAISalesAgentSettings(fresh?.aiSalesAgent),
      configured: isOpenAIConfigured(fresh?.aiAuthoring),
    });
  },
);
