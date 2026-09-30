import { AuthorizationError, ServiceUnavailableError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import type { AIAuthoringEntity } from "./types";
import {
  aiAuthoringBlock,
  resolveAIAuthoringAvailability,
  surfaceForEntity,
  type AIAuthoringAvailability,
  type AIAuthoringBlock,
  type AIAuthoringCaller,
  type AIAuthoringSurfaceKey,
} from "./access";
import {
  resolveAIAuthoringConfig,
  type ResolvedAIAuthoringConfig,
} from "./settings";
import { consumeAIUsage, type AIUsageKind } from "./usage";

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
 * What a dashboard may offer this caller, per surface. Handed to the layouts'
 * `AiAvailabilityProvider` so every AI button in the tree hides itself the
 * moment Settings → AI says it should, instead of staying live and failing on
 * the route.
 *
 * `getSettings` is request-memoised, so a layout that already read settings
 * pays nothing for this.
 */
export async function getAIAuthoringAvailability(options: {
  caller: AIAuthoringCaller;
  /** See `AIAuthoringGate.vendorGranted` — pass it for a vendor caller. */
  vendorGranted?: boolean;
}): Promise<AIAuthoringAvailability> {
  const runtime = await getAIAuthoringRuntime();
  return resolveAIAuthoringAvailability({
    settings: runtime.settings,
    apiKey: runtime.apiKey,
    ...options,
  });
}

/** The wording each block has always answered with, kept caller-aware. */
function blockMessage(
  block: Exclude<AIAuthoringBlock, "unconfigured">,
  caller: AIAuthoringCaller,
): string {
  switch (block) {
    case "disabled":
      return "AI authoring is disabled in Settings";
    case "surface_off":
      return "AI authoring is turned off for this surface in Settings";
    case "role_off":
      return caller === "staff"
        ? "AI authoring is not enabled for staff accounts"
        : "AI authoring is not enabled for vendor accounts";
    case "plan_off":
      return "AI Studio is not included in your plan. Upgrade to a plan with AI Authoring.";
  }
}

/**
 * The one gate every AI authoring route goes through: feature enabled, key
 * present, surface toggled on, caller role allowed, and the caller's daily
 * cap consumed. Returns the runtime so the route can pass key/model/brand
 * voice into generation without a second settings read.
 *
 * The vendor plan/permission half lives in `assertVendorAuthoringAccess`,
 * which the vendor routes call first — hence no `vendorGranted` here.
 */
export async function assertAIAuthoringAllowed(options: {
  /** Omit for surface-agnostic routes; hero banner passes `surface` instead. */
  entity?: AIAuthoringEntity;
  surface?: AIAuthoringSurfaceKey;
  caller: AIAuthoringCaller;
  userId: string;
  kind: AIUsageKind;
}): Promise<ResolvedAIAuthoringConfig> {
  const runtime = await getAIAuthoringRuntime();
  const { settings } = runtime;

  const block = aiAuthoringBlock({
    settings,
    apiKey: runtime.apiKey,
    caller: options.caller,
    surface:
      options.surface ??
      (options.entity ? surfaceForEntity(options.entity) : undefined),
  });

  if (block === "unconfigured") {
    throw new ServiceUnavailableError(
      "AI is not configured. Add an OpenAI API key in Settings → AI.",
    );
  }
  if (block) {
    throw new AuthorizationError(blockMessage(block, options.caller));
  }

  const limit =
    options.kind === "image"
      ? settings.limits.imagePerUserPerDay
      : settings.limits.textPerUserPerDay;
  await consumeAIUsage(options.userId, options.kind, limit);

  return runtime;
}
