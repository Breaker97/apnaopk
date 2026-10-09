"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  STORE_PROFILE_MISSING,
  STORE_PROFILE_NEEDS_REVIEW,
  STORE_PROFILE_NO_OWNER,
} from "@/lib/inventory/store-profile";
import type { ProductFormOptionsStatus } from "@/components/admin/product-form/use-product-form-options";

/**
 * Said only when the editor's reference data could not be loaded (or is being
 * asked for again after that). An empty catalogue is a real answer and says
 * nothing here — the category picker's own "create a category first" covers
 * it. In red while the form cannot be saved yet, amber once lists from an
 * earlier answer are still on screen.
 */
export function FormOptionsNotice({
  status,
  failed,
  usable,
  errorCode,
  onRetry,
}: {
  status: ProductFormOptionsStatus;
  /** The last answer was a failure; stays true while a retry runs. */
  failed: boolean;
  usable: boolean;
  errorCode: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations("admin.productForm.formOptions");
  if (!failed) return null;
  const retrying = status === "loading";

  return (
    <WarningBanner
      role="alert"
      tone={usable ? "warning" : "danger"}
      title={t("failedTitle")}
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("retry")}
        </Button>
      }
    >
      {errorCode === STORE_PROFILE_MISSING
        ? t("storeProfileMissing")
        : errorCode === STORE_PROFILE_NO_OWNER
          ? t("storeProfileNoOwner")
          : errorCode === STORE_PROFILE_NEEDS_REVIEW
            ? t("storeProfileNeedsReview")
            : usable
              ? t("failedAfterLoadedBody")
              : t("failedBody")}
    </WarningBanner>
  );
}
