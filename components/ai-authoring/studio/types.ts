import type { AIAuthoringMediaResponse } from "@/lib/ai-authoring/types";

export type StudioImage = { _id: string; url: string; alt?: string };

export type StudioVersion = {
  url: string;
  /** null on the untouched original; set on every AI-generated version. */
  response: AIAuthoringMediaResponse | null;
  /** Render on a checkerboard because the result background is transparent. */
  transparent?: boolean;
};

export type StudioSession = { versions: StudioVersion[]; index: number };

/** Session key for an image generated from scratch (no grid source). */
export const SCRATCH_KEY = "__scratch__";

export type StudioTab = "quick" | "effects";
