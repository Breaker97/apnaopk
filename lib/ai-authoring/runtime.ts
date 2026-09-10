import { AuthorizationError, ServiceUnavailableError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import type { AIAuthoringEntity } from "./types";
import {
  resolveAIAuthoringConfig,
  surfaceForEntity,
  type ResolvedAIAuthoringConfig,
} from "./settings";
import { consumeAIUsage, type AIUsageKind } from "./usage";

type AIAuthoringCaller = "admin" | "staff" | "vendor";

/** Load the stored aiAuthoring settings and resolve key/models. */
export async function getAIAuthoringRuntime(): Promise<ResolvedAIAuthoringConfig> {
  const settings = await getSettings();
  return resolveAIAuthoringConfig(settings.aiAuthoring);
}

/** True when AI authoring can actually serve requests (enabled + key). */
export async function isAIAuthoringReady(): Promise<boolean> {
  const runtime = await getAIAuthoringRuntime();
  return runtime.settings.enabled && Boolean(runtime.apiKey);
}

/**
 * The one gate every AI authoring route goes through: feature enabled, key
 * present, surface toggled on, caller role allowed, and the caller's daily
 * cap consumed. Returns the runtime so the route can pass key/model/brand
 * voice into generation without a second settings read.
 */
export async function assertAIAuthoringAllowed(options: {
  /** Omit for surface-agnostic routes; hero banner passes `surface` instead. */
  entity?: AIAuthoringEntity;
  surface?: "heroBanner";
  caller: AIAuthoringCaller;
  userId: string;
  kind: AIUsageKind;
}): Promise<ResolvedAIAuthoringConfig> {
  const runtime = await getAIAuthoringRuntime();
  const { settings } = runtime;

  if (!settings.enabled) {
    throw new AuthorizationError("AI authoring is disabled in Settings");
  }
  if (!runtime.apiKey) {
    throw new ServiceUnavailableError(
      "AI is not configured. Add an OpenAI API key in Settings → AI.",
    );
  }

  const surfaceKey = options.surface ?? (options.entity ? surfaceForEntity(options.entity) : null);
  if (surfaceKey && !settings.surfaces[surfaceKey]) {
    throw new AuthorizationError(
      "AI authoring is turned off for this surface in Settings",
    );
  }

  if (options.caller === "staff" && !settings.access.staffEnabled) {
    throw new AuthorizationError(
      "AI authoring is not enabled for staff accounts",
    );
  }
  if (options.caller === "vendor" && !settings.access.vendorsEnabled) {
    throw new AuthorizationError(
      "AI authoring is not enabled for vendor accounts",
    );
  }

  const limit =
    options.kind === "image"
      ? settings.limits.imagePerUserPerDay
      : settings.limits.textPerUserPerDay;
  await consumeAIUsage(options.userId, options.kind, limit);

  return runtime;
}
