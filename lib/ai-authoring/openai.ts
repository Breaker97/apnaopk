import OpenAI from "openai";

type OpenAIMessageContent = {
  text?: string;
};

type OpenAIMessageItem = {
  type?: string;
  content?: OpenAIMessageContent[];
};

type OpenAIResponseLike = {
  output_text?: string;
  output?: OpenAIMessageItem[];
};

export function isAIAuthoringConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Build the OpenAI client from a resolved key (Settings → AI, DB wins with
 * OPENAI_API_KEY env fallback). Callers that already ran the authoring gate
 * pass the runtime's key; the env-only default keeps older paths working.
 */
export function createAIAuthoringOpenAIClient(resolvedApiKey?: string): OpenAI {
  const apiKey = resolvedApiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI API key is not configured");
  return new OpenAI({ apiKey });
}

export function extractOutputText(response: unknown): string {
  const candidate = response as OpenAIResponseLike;
  if (typeof candidate?.output_text === "string" && candidate.output_text.trim()) {
    return candidate.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of candidate?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }

  return chunks.join("\n").trim();
}
