import type { AIAuthoringRequest } from "./types";
import {
  buildAuthoringInstructions,
  buildContentInput,
  normalizeContentDraft,
  type AIAuthoringContentRuntime,
} from "./content";
import { createAIAuthoringOpenAIClient } from "./openai";

/**
 * Server-sent-events streaming for long-form, single-field text generation.
 * Only operations whose output is one field can stream (the structured
 * multi-field JSON contract can't be shown token-by-token meaningfully).
 *
 * Wire format, one JSON object per SSE `data:` frame:
 *   { "delta": "…" }          — appended output text
 *   { "done": true, "draft" } — the final draft, same shape as the
 *                                non-streaming endpoint (sanitized server-side)
 *   { "error": "…" }          — terminal failure
 */
const STREAMABLE_OPERATIONS = new Set<string>([
  "summary",
  "description",
  "rich_content",
]);

export function canStreamAuthoringRequest(request: AIAuthoringRequest): boolean {
  return STREAMABLE_OPERATIONS.has(request.operation) && !!request.targetField;
}

type StreamEventLike = {
  type?: string;
  delta?: string;
};

export async function streamAuthoringContent(
  request: AIAuthoringRequest,
  runtime: AIAuthoringContentRuntime = {},
): Promise<ReadableStream<Uint8Array>> {
  const client = createAIAuthoringOpenAIClient(runtime.apiKey);
  const isHtml =
    request.constraints?.html || request.operation === "rich_content";
  const instructions = [
    buildAuthoringInstructions(request, runtime.brandVoice),
    `Streaming mode override: output ONLY the value for "${request.targetField}" as ${
      isHtml
        ? "HTML using only the allowed tags"
        : "plain text"
    }. No JSON, no code fences, no field names, no commentary.`,
  ].join("\n");

  const openaiStream = (await client.responses.create({
    model:
      runtime.model ||
      process.env.OPENAI_AUTHORING_TEXT_MODEL ||
      "gpt-4.1-mini",
    instructions,
    input: buildContentInput(request),
    stream: true,
  })) as AsyncIterable<StreamEventLike>;

  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    payload: unknown,
  ) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullText = "";
      try {
        for await (const event of openaiStream) {
          if (
            event?.type === "response.output_text.delta" &&
            typeof event.delta === "string"
          ) {
            fullText += event.delta;
            send(controller, { delta: event.delta });
          }
        }
        const draft = normalizeContentDraft(request, {
          fields: { [request.targetField as string]: fullText },
        });
        send(controller, { done: true, draft });
      } catch {
        // Never leak provider error details to the browser.
        send(controller, { error: "AI generation failed. Please try again." });
      } finally {
        controller.close();
      }
    },
  });
}
