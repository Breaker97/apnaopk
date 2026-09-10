"use client";

import * as React from "react";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorFallback } from "@/components/errors/error-fallback";

export default function Error({
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

  const shouldHardReload = React.useMemo(() => {
    const message = String(error?.message || "");
    return (
      /module factory is not available/i.test(message) ||
      /chunkloaderror/i.test(message) ||
      /loading chunk/i.test(message) ||
      /failed to fetch dynamically imported module/i.test(message)
    );
  }, [error?.message]);

  React.useEffect(() => {
    if (!shouldHardReload) return;
    if (typeof window === "undefined") return;
    const key = `hard-reload-once:${pathname}`;
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }, [pathname, shouldHardReload]);

  return (
    <ErrorFallback
      title={t("errors.serverError")}
      description={t("errors.serverErrorDescription")}
      homeLabel={t("common.home")}
      retryLabel={t("common.tryAgain")}
      homeHref={`/${locale}`}
      error={error}
      onRetry={() => {
        if (shouldHardReload && typeof window !== "undefined") {
          window.location.reload();
          return;
        }
        reset();
      }}
      locale={locale}
      route={pathname}
    />
  );
}
