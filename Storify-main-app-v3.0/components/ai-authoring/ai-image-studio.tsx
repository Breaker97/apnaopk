/**
 * Stable import path for the AI Image Studio. The implementation lives in
 * ./studio/ — a composition shell over the session/viewport/actions hooks and
 * the panel components — so callers keep this historical path.
 */
export { AiImageStudio } from "./studio/ai-image-studio";
export type { StudioImage } from "./studio/types";
