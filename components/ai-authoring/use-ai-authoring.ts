"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type {
  AIAuthoringContentResponse,
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
  AIAuthoringRequest,
} from "@/lib/ai-authoring/types";
import type {
  SocialExportRequest,
  SocialExportResponse,
} from "@/lib/ai-authoring/social-export/types";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

type UseAiAuthoringOptions = {
  contentEndpoint: string;
  mediaEndpoint?: string;
  socialExportEndpoint?: string;
};

async function postJson<T>(endpoint: string, payload: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.message || result.error || "AI generation failed");
  }
  return result.data;
}

export function useAiAuthoring({
  contentEndpoint,
  mediaEndpoint,
  socialExportEndpoint,
}: UseAiAuthoringOptions) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const generateContent = useCallback(
    async (
      key: string,
      request: AIAuthoringRequest,
    ): Promise<AIAuthoringContentResponse | null> => {
      setLoadingKey(key);
      try {
        return await postJson<AIAuthoringContentResponse>(
          contentEndpoint,
          request,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "AI generation failed");
        return null;
      } finally {
        setLoadingKey(null);
      }
    },
    [contentEndpoint],
  );

  /**
   * Streaming variant of generateContent against the `/stream` sibling of the
   * content endpoint. `onDelta` receives the accumulated text as it grows; the
   * resolved draft comes from the final SSE frame (sanitized server-side) so
   * applying it behaves exactly like the non-streaming path. Falls back to a
   * JSON error envelope if the server rejected the request before streaming.
   */
  const generateContentStream = useCallback(
    async (
      key: string,
      request: AIAuthoringRequest,
      onDelta: (text: string) => void,
    ): Promise<AIAuthoringContentResponse | null> => {
      setLoadingKey(key);
      try {
        const response = await fetch(`${contentEndpoint}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          const result = (await response
            .json()
            .catch(() => ({}))) as ApiResponse<never>;
          throw new Error(
            result.message || result.error || "AI generation failed",
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        let draft: AIAuthoringContentResponse | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame
              .split("\n")
              .find((entry) => entry.startsWith("data: "));
            if (!line) continue;
            let payload: {
              delta?: string;
              done?: boolean;
              draft?: AIAuthoringContentResponse;
              error?: string;
            };
            try {
              payload = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (payload.error) throw new Error(payload.error);
            if (typeof payload.delta === "string") {
              accumulated += payload.delta;
              onDelta(accumulated);
            }
            if (payload.done && payload.draft) draft = payload.draft;
          }
        }
        if (!draft) throw new Error("AI generation failed");
        return draft;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "AI generation failed",
        );
        return null;
      } finally {
        setLoadingKey(null);
      }
    },
    [contentEndpoint],
  );

  const generateMedia = useCallback(
    async (
      key: string,
      request: AIAuthoringRequest,
      options?: AIAuthoringMediaOptions,
    ): Promise<AIAuthoringMediaResponse | null> => {
      if (!mediaEndpoint) {
        toast.error("AI media generation is not available here");
        return null;
      }
      setLoadingKey(key);
      try {
        return await postJson<AIAuthoringMediaResponse>(mediaEndpoint, {
          ...request,
          options,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "AI image generation failed");
        return null;
      } finally {
        setLoadingKey(null);
      }
    },
    [mediaEndpoint],
  );

  /**
   * Render the given own-storage image to a social size (deterministic sharp,
   * no AI cost). Returns the uploaded export so the caller can download it.
   */
  const exportSocial = useCallback(
    async (
      key: string,
      request: SocialExportRequest,
    ): Promise<SocialExportResponse | null> => {
      if (!socialExportEndpoint) {
        toast.error("Social export is not available here");
        return null;
      }
      setLoadingKey(key);
      try {
        return await postJson<SocialExportResponse>(
          socialExportEndpoint,
          request,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Export failed");
        return null;
      } finally {
        setLoadingKey(null);
      }
    },
    [socialExportEndpoint],
  );

  return {
    loadingKey,
    isLoading: (key: string) => loadingKey === key,
    generateContent,
    generateContentStream,
    generateMedia,
    exportSocial,
  };
}
