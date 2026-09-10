"use client";

import { useTranslations } from "next-intl";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useAdminSettingsContext } from "../admin-settings-context";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export function useUnsavedNavigation() {
  const t = useTranslations();
  const { confirm } = useConfirmation();
  const { hasUnsaved, refetch } = useAdminSettingsContext();

  const tSafe = useFallbackTranslator(t);

  return async (
    _href: string,
    proceed: () => void,
  ): Promise<void> => {
    if (hasUnsaved()) {
      const ok = await confirm({
        title: tSafe("admin.settings.unsavedChanges.title", "Unsaved changes"),
        description: tSafe(
          "admin.settings.unsavedChanges.description",
          "Discard your unsaved changes and switch sections?",
        ),
        confirmText: tSafe("admin.settings.unsavedChanges.confirm", "Discard"),
        cancelText: tSafe("admin.settings.unsavedChanges.cancel", "Stay"),
        type: "danger",
        confirmVariant: "destructive",
      });
      if (!ok) return;
      await refetch();
    }
    proceed();
  };
}
