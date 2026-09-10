import type { IAISalesAgentSettings } from "@/models/settings.model";
import { resolveOpenAICredentials } from "@/lib/settings/credentials";
import {
  AI_SALES_AGENT_MODEL_IDS,
  AI_SALES_AGENT_REASONING_EFFORTS,
  AI_SALES_AGENT_TONES,
  DEFAULT_AI_SALES_AGENT_MODEL,
  type AISalesAgentModel,
  type AISalesAgentReasoningEffort,
  type AISalesAgentTone,
} from "./models";
import type { PublicAISalesAgentConfig } from "./types";

export const DEFAULT_AI_SALES_AGENT_SETTINGS: IAISalesAgentSettings = {
  enabled: false,
  model: DEFAULT_AI_SALES_AGENT_MODEL,
  temperature: 0.3,
  reasoningEffort: "minimal",
  maxRecommendations: 4,
  agentName: "Sales AI",
  greeting:
    "Hi! I can help you find products, compare options, add items to your cart, and check order status.",
  tone: "friendly",
  instructions: "",
  escalationMessage:
    "I can connect you with the store team for anything that needs a human review.",
  widget: {
    position: "bottom-right",
    primaryColor: "#7c3aed",
    accentColor: "#a855f7",
    avatarUrl: "",
    footerText: "Powered by AI",
    headerTitle: "",
    width: 400,
    height: 680,
    showFooterText: true,
  },
  capabilities: {
    productQA: true,
    recommendations: true,
    cartActions: true,
    checkoutHandoff: true,
    orderStatus: true,
  },
  faq: [],
};

const MODEL_SET = new Set<string>(AI_SALES_AGENT_MODEL_IDS);
const REASONING_SET = new Set<string>(AI_SALES_AGENT_REASONING_EFFORTS);
const TONE_SET = new Set<string>(AI_SALES_AGENT_TONES);

function toPlain<T>(value: T): Partial<IAISalesAgentSettings> {
  if (!value || typeof value !== "object") return {};
  const maybeDoc = value as { toObject?: () => unknown };
  if (typeof maybeDoc.toObject === "function") {
    const obj = maybeDoc.toObject();
    return obj && typeof obj === "object"
      ? (obj as Partial<IAISalesAgentSettings>)
      : {};
  }
  return value as Partial<IAISalesAgentSettings>;
}

export function normalizeAISalesAgentSettings(
  value: Partial<IAISalesAgentSettings> | null | undefined,
): IAISalesAgentSettings {
  const incoming = toPlain(value);
  const widgetIncoming = toPlain(incoming.widget);
  const capabilitiesIncoming = toPlain(incoming.capabilities);
  const faqIncoming = Array.isArray(incoming.faq)
    ? (incoming.faq as unknown[])
        .map((entry) => toPlain(entry) as Record<string, unknown>)
        .filter((entry) => {
          const question = entry.question;
          const answer = entry.answer;
          return (
            typeof question === "string" &&
            typeof answer === "string" &&
            question.trim().length > 0 &&
            answer.trim().length > 0
          );
        })
        .map((entry) => ({
          question: String(entry.question).trim(),
          answer: String(entry.answer).trim(),
          tags: Array.isArray(entry.tags)
            ? (entry.tags as unknown[])
                .filter((tag): tag is string => typeof tag === "string")
                .map((tag) => tag.trim())
                .filter(Boolean)
            : [],
        }))
    : undefined;
  const model =
    typeof incoming.model === "string" && MODEL_SET.has(incoming.model)
      ? (incoming.model as AISalesAgentModel)
      : DEFAULT_AI_SALES_AGENT_SETTINGS.model;
  const reasoningEffort =
    typeof incoming.reasoningEffort === "string" &&
    REASONING_SET.has(incoming.reasoningEffort)
      ? (incoming.reasoningEffort as AISalesAgentReasoningEffort)
      : DEFAULT_AI_SALES_AGENT_SETTINGS.reasoningEffort;
  const tone =
    typeof incoming.tone === "string" && TONE_SET.has(incoming.tone)
      ? (incoming.tone as AISalesAgentTone)
      : DEFAULT_AI_SALES_AGENT_SETTINGS.tone;

  return {
    ...DEFAULT_AI_SALES_AGENT_SETTINGS,
    ...incoming,
    model,
    reasoningEffort,
    tone,
    widget: {
      ...DEFAULT_AI_SALES_AGENT_SETTINGS.widget,
      ...widgetIncoming,
    },
    capabilities: {
      ...DEFAULT_AI_SALES_AGENT_SETTINGS.capabilities,
      ...capabilitiesIncoming,
    },
    faq: faqIncoming ?? DEFAULT_AI_SALES_AGENT_SETTINGS.faq,
  };
}

/**
 * Whether an OpenAI key is available. Pass `settings.aiAuthoring` so a key
 * saved in Settings → AI counts; without it only the env fallback is seen.
 */
export function isOpenAIConfigured(aiAuthoring?: { apiKey?: string } | null) {
  return Boolean(resolveOpenAICredentials(aiAuthoring).apiKey);
}

export function toPublicAISalesAgentConfig(
  settings: IAISalesAgentSettings,
  options?: { faviconUrl?: string; aiAuthoring?: { apiKey?: string } | null },
): PublicAISalesAgentConfig {
  const configured = isOpenAIConfigured(options?.aiAuthoring);
  return {
    enabled: Boolean(settings.enabled && configured),
    configured,
    agentName: settings.agentName,
    greeting: settings.greeting,
    widget: settings.widget,
    capabilities: settings.capabilities,
    faviconUrl: options?.faviconUrl?.trim() || undefined,
  };
}
