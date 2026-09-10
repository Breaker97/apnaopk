import { ValidationError } from "@/lib/api/errors";
import { findSocialExportSize } from "./presets";
import type {
  SocialExportFormat,
  SocialExportMode,
  SocialExportRequest,
} from "./types";
import { isRecord } from "@/lib/utils";

const MODES: SocialExportMode[] = ["cover", "pad"];
const FORMATS: SocialExportFormat[] = ["png", "jpeg"];

/** Validate the client payload for a social export request. */
export function validateSocialExportRequest(
  payload: unknown,
): SocialExportRequest {
  if (!isRecord(payload)) {
    throw new ValidationError("Invalid social export request");
  }

  const sourceUrl = payload.sourceUrl;
  if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
    throw new ValidationError("A source image is required to export");
  }

  const size = findSocialExportSize(payload.sizeKey);
  if (!size) {
    throw new ValidationError("Unsupported export size");
  }

  const mode = MODES.includes(payload.mode as SocialExportMode)
    ? (payload.mode as SocialExportMode)
    : "cover";
  const format = FORMATS.includes(payload.format as SocialExportFormat)
    ? (payload.format as SocialExportFormat)
    : "png";

  return {
    sourceUrl: sourceUrl.trim(),
    sizeKey: size.key,
    mode,
    format,
    useLogo: payload.useLogo === true,
  };
}
