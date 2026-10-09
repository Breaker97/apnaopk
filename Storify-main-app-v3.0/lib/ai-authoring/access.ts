/**
 * The availability rules for AI authoring, as pure functions.
 *
 * Two sides of the feature read them and must agree. `assertAIAuthoringAllowed`
 * turns a block into the error a route answers with; the dashboard layouts turn
 * the same blocks into the flags that decide whether a form renders its AI
 * buttons at all. Settings → AI promises that its switch "turns the AI Studio
 * and every AI button on or off across the dashboard", and that only holds
 * while the UI and the routes share one definition of "on" — a second copy of
 * these rules for the client is exactly how the buttons came to outlive the
 * switch that was meant to remove them.
 *
 * Nothing here touches the DB, the session or OpenAI, so a client component can
 * import it: the only non-type dependency is the entity list.
 */

import type { IAIAuthoringSettings } from "@/models/settings.model";
import type { AIAuthoringEntity } from "./types";

export type AIAuthoringSurfaceKey = keyof IAIAuthoringSettings["surfaces"];

export type AIAuthoringCaller = "admin" | "staff" | "vendor";

/** Which settings surface toggle governs each authoring entity. */
export function surfaceForEntity(
  entity: AIAuthoringEntity,
): AIAuthoringSurfaceKey {
  switch (entity) {
    case "product":
      return "products";
    case "category":
      return "categories";
    case "collection":
      return "collections";
    case "brand":
      return "brands";
    case "blog_post":
      return "blogPosts";
    case "content_page":
      return "contentPages";
    case "review_reply":
      return "reviews";
  }
}

/**
 * Why AI authoring is unavailable. `unconfigured` is the operator's own
 * omission (no API key) rather than a decision, which is why the routes answer
 * it 503 while every other block is a 403.
 */
export type AIAuthoringBlock =
  | "disabled"
  | "unconfigured"
  | "surface_off"
  | "role_off"
  | "plan_off";

type AIAuthoringGate = {
  settings: IAIAuthoringSettings;
  /** Resolved key (DB value or `OPENAI_API_KEY`), not the stored field. */
  apiKey?: string;
  caller: AIAuthoringCaller;
  /** Omit for surface-agnostic checks — "is AI usable at all for this caller". */
  surface?: AIAuthoringSurfaceKey;
  /**
   * Whether the vendor's plan and `ACCESS_AI_STUDIO` permission grant
   * authoring. Omit where that gate is asserted separately — the routes call
   * `assertVendorAuthoringAccess` first — so omission reads as "checked
   * elsewhere", never as "denied".
   */
  vendorGranted?: boolean;
};

/**
 * The first gate that refuses this caller, or null when none does.
 *
 * Order matters: it is the order the errors were worded in, so a store with
 * both the feature off and no key still says "disabled" rather than sending
 * its operator to add a key they do not need yet.
 *
 * The per-user daily cap is deliberately not here. It is spent, not
 * configured — a button that vanished on the day's last generation would read
 * as a broken dashboard, where the cap's own error says plainly what happened.
 */
export function aiAuthoringBlock(gate: AIAuthoringGate): AIAuthoringBlock | null {
  const { settings, caller, surface } = gate;

  if (!settings.enabled) return "disabled";
  if (!gate.apiKey) return "unconfigured";
  if (surface && !settings.surfaces[surface]) return "surface_off";
  if (caller === "staff" && !settings.access.staffEnabled) return "role_off";
  if (caller === "vendor" && !settings.access.vendorsEnabled) return "role_off";
  if (caller === "vendor" && gate.vendorGranted === false) return "plan_off";

  return null;
}

/**
 * What a dashboard may show this caller: one flag per surface toggle, each
 * already folded together with the feature switch, the key, the caller's role
 * and (for a vendor) their plan. A client only has to ask "may I render this
 * button", never to re-derive why.
 */
export type AIAuthoringAvailability = {
  /** AI is usable by this caller somewhere — what the sidebar entry needs. */
  available: boolean;
  /**
   * Per surface, `available && surfaces[key]`. Partial on purpose: a missing
   * key reads as false, so a client with no provider above it (or one built
   * before a surface existed) hides the button rather than offering a dead one.
   */
  surfaces: Partial<Record<AIAuthoringSurfaceKey, boolean>>;
};

/** Nothing is available. The client default, and what an unapproved vendor gets. */
export const NO_AI_AUTHORING_AVAILABILITY: AIAuthoringAvailability = {
  available: false,
  surfaces: {},
};

/**
 * Run `aiAuthoringBlock` once per surface. The keys come from the settings
 * object itself — it arrives through `normalizeAIAuthoringSettings`, which
 * fills every one — so adding a surface to the model needs no edit here.
 */
export function resolveAIAuthoringAvailability(
  gate: Omit<AIAuthoringGate, "surface">,
): AIAuthoringAvailability {
  const available = aiAuthoringBlock(gate) === null;
  const surfaces: Partial<Record<AIAuthoringSurfaceKey, boolean>> = {};

  for (const key of Object.keys(gate.settings.surfaces) as AIAuthoringSurfaceKey[]) {
    surfaces[key] = available && aiAuthoringBlock({ ...gate, surface: key }) === null;
  }

  return { available, surfaces };
}
