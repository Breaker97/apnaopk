"use client";

/**
 * Carries "may this dashboard offer AI here" down to every AI control.
 *
 * The three dashboard layouts (admin, staff, vendor) resolve it on the server —
 * where the settings, the session and the vendor's plan already are — and hand
 * the result down as plain data. Nothing fetches: a form that mounts ten AI
 * fields asks the context ten times and makes no request, and there is no gap
 * on load where a button is offered before it is known to be allowed.
 *
 * The default is "nothing is available". A control rendered outside any
 * provider therefore hides, which is the safe direction: the failure people
 * would never report is an AI button that quietly keeps working after the
 * operator switched the feature off.
 */

import { createContext, useContext, type ReactNode } from "react";
import {
  NO_AI_AUTHORING_AVAILABILITY,
  surfaceForEntity,
  type AIAuthoringAvailability,
  type AIAuthoringSurfaceKey,
} from "@/lib/ai-authoring/access";
import type { AIAuthoringEntity } from "@/lib/ai-authoring/types";

const AiAvailabilityContext = createContext<AIAuthoringAvailability>(
  NO_AI_AUTHORING_AVAILABILITY,
);

export function AiAvailabilityProvider({
  value,
  children,
}: {
  value: AIAuthoringAvailability;
  children: ReactNode;
}) {
  return (
    <AiAvailabilityContext.Provider value={value}>
      {children}
    </AiAvailabilityContext.Provider>
  );
}

/** The whole verdict — for a nav entry that asks only "is AI usable at all". */
export function useAiAvailability(): AIAuthoringAvailability {
  return useContext(AiAvailabilityContext);
}

/** Whether one surface's AI controls may render. */
export function useAiSurfaceAllowed(surface: AIAuthoringSurfaceKey): boolean {
  return Boolean(useContext(AiAvailabilityContext).surfaces[surface]);
}

/** The same question asked with the entity a control already holds. */
export function useAiEntityAllowed(entity: AIAuthoringEntity): boolean {
  return useAiSurfaceAllowed(surfaceForEntity(entity));
}
