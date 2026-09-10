import { NextResponse } from "next/server";
import { DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";

export {
  DEMO_MODE_MESSAGE,
  PROFILE_DEMO_MODE_MESSAGE,
  STORE_BUILDER_DEMO_MODE_MESSAGE,
} from "@/lib/demo-mode-shared";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value: string | undefined) {
  return TRUE_VALUES.has((value || "").trim().toLowerCase());
}

export function isDemoModeEnabled() {
  return (
    isEnabled(process.env.DEMO_MODE) ||
    isEnabled(process.env.NEXT_PUBLIC_DEMO_MODE)
  );
}

function demoModeResponse(message = DEMO_MODE_MESSAGE) {
  return NextResponse.json(
    {
      success: false,
      message,
      code: "DEMO_MODE_READ_ONLY",
    },
    { status: 403 },
  );
}

export function getDemoModeMutationResponse({
  when = true,
  message = DEMO_MODE_MESSAGE,
}: {
  when?: boolean;
  message?: string;
} = {}) {
  if (!when || !isDemoModeEnabled()) return null;
  return demoModeResponse(message);
}
