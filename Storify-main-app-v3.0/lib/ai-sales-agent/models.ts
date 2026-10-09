export type AISalesAgentModel =
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-4.1-mini";

export type AISalesAgentReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high";

export type AISalesAgentTone =
  | "friendly"
  | "professional"
  | "playful"
  | "luxury";

export const AI_SALES_AGENT_MODELS: ReadonlyArray<{
  id: AISalesAgentModel;
  label: string;
  reasoning: boolean;
}> = [
  { id: "gpt-5-mini", label: "GPT-5 mini", reasoning: true },
  { id: "gpt-5", label: "GPT-5", reasoning: true },
  { id: "gpt-5-nano", label: "GPT-5 nano", reasoning: true },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", reasoning: false },
];

export const AI_SALES_AGENT_MODEL_IDS = AI_SALES_AGENT_MODELS.map(
  (model) => model.id,
) as ReadonlyArray<AISalesAgentModel>;

export const AI_SALES_AGENT_REASONING_EFFORTS: ReadonlyArray<AISalesAgentReasoningEffort> =
  ["minimal", "low", "medium", "high"];

export const AI_SALES_AGENT_TONES: ReadonlyArray<AISalesAgentTone> = [
  "friendly",
  "professional",
  "playful",
  "luxury",
];

export const DEFAULT_AI_SALES_AGENT_MODEL: AISalesAgentModel = "gpt-5-mini";

export function isReasoningModel(model: string): boolean {
  return AI_SALES_AGENT_MODELS.some(
    (entry) => entry.id === model && entry.reasoning,
  );
}
