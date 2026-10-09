"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  actionLabelKey,
  labelFor,
  resourceLabelKey,
  roleLabelKey,
} from "@/lib/activity-log/labels";

/**
 * The Activity Log's stored values in the viewer's language. Each resolves
 * through a locale message and falls back to a humanized form of the value, so
 * one nobody has written a message for yet still reads as words.
 */
export function useActivityLabels() {
  const t = useTranslations();
  return useMemo(
    () => ({
      action: (action: string) => labelFor(t, actionLabelKey(action), action),
      resource: (resource: string) => labelFor(t, resourceLabelKey(resource), resource),
      role: (role: string) => labelFor(t, roleLabelKey(role), role),
    }),
    [t],
  );
}
