"use client";

import { useTranslations } from "next-intl";
import { WarningBanner } from "@/components/ui/warning-banner";
import { cn } from "@/lib/utils";
import {
  STORE_PROFILE_NEEDS_REVIEW,
  STORE_PROFILE_NO_OWNER,
  isStoreProfileErrorCode,
} from "@/lib/inventory/store-profile";

/**
 * The profile code an API answer carries, if it is one — read from a parsed
 * `{ success: false, code }` body or an `ApiClientError`.
 */
export function storeProfileCodeOf(answer: unknown): string | null {
  const code = (answer as { code?: unknown } | null)?.code;
  return isStoreProfileErrorCode(code) ? (code as string) : null;
}

/**
 * Why a screen built on the store's own locations cannot show them: the house
 * store profile is missing and could not be made (see `ensureDefaultVendorId`).
 * Said once, where the list would be, with what fixes it — instead of an empty
 * list that looks like a store with no locations.
 */
export function StoreProfileNotice({
  code,
  compact = false,
  className,
}: {
  code: string;
  /** One quiet line, for a picker inside a form, pointing to Settings → General. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("admin.storeProfile");
  const reason =
    code === STORE_PROFILE_NO_OWNER
      ? t("noOwner")
      : code === STORE_PROFILE_NEEDS_REVIEW
        ? t("needsReview")
        : t("missing");

  // Inside a form the reason would crowd the picker; Settings → General says it.
  if (compact) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {t("pickerNote")}
      </p>
    );
  }

  return (
    <WarningBanner title={t("title")} className={className}>
      {reason}
    </WarningBanner>
  );
}
