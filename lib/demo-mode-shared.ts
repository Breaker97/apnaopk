export const DEMO_MODE_MESSAGE =
  "Demo mode is enabled. Deletes, settings edits, and test actions are disabled on this demo site — everything else, including creating products and uploading images, works normally.";

export const STORE_BUILDER_DEMO_MODE_MESSAGE =
  "Demo mode is on. Edit this page freely to see how the builder works — nothing is written to the database, and publishing, discarding, and deleting are disabled on this demo site.";

export const PROFILE_DEMO_MODE_MESSAGE =
  "Demo mode is enabled. Profile changes are disabled on this demo site.";

export interface DemoModeState {
  enabled: boolean;
  message: string;
}

export const DEFAULT_PROFILE_DEMO_MODE: DemoModeState = {
  enabled: false,
  message: PROFILE_DEMO_MODE_MESSAGE,
};

export function normalizeDemoModeState(
  value: unknown,
  fallbackMessage = PROFILE_DEMO_MODE_MESSAGE,
): DemoModeState {
  if (!value || typeof value !== "object") {
    return {
      enabled: false,
      message: fallbackMessage,
    };
  }

  const demoMode = value as { enabled?: unknown; message?: unknown };
  const message =
    typeof demoMode.message === "string" && demoMode.message.trim()
      ? demoMode.message
      : fallbackMessage;

  return {
    enabled: Boolean(demoMode.enabled),
    message,
  };
}
