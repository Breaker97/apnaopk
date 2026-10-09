"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { usePathname } from "@/hooks/use-locale-navigation";
import { useErrorReporting } from "@/hooks/use-error-reporting";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * What the Activity Log's route shows when its query fails.
 *
 * A route-level boundary, so the dashboard around it — the sidebar, the header —
 * stays up and "try again" re-runs only this list. The locale-wide boundary that
 * would otherwise catch it replaces the whole page, and the log is the one list
 * that can fail for being too large to read, not only for being down.
 */
export function ActivityLogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  const params = useParams();
  const pathname = usePathname();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  useErrorReporting(error, { digest: error.digest, locale, route: pathname });

  return (
    <Card role="alert">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <TriangleAlert aria-hidden="true" className="h-8 w-8 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium">{t("errors.serverError")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("errors.serverErrorDescription")}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={reset}>
          {t("common.tryAgain")}
        </Button>
      </CardContent>
    </Card>
  );
}
