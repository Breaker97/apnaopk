"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminSettingsContext } from "./admin-settings-context";
import type { Settings } from "./types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export function SectionLoader({
  children,
}: {
  children: (settings: Settings) => React.ReactNode;
}) {
  const t = useTranslations();
  const { isLoading, settings } = useAdminSettingsContext();

  const tSafe = useFallbackTranslator(t);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full max-w-3xl" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {tSafe("admin.settings.loadError", "Failed to load settings")}
      </div>
    );
  }

  return <>{children(settings)}</>;
}
