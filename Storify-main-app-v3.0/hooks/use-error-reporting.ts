"use client";

import * as React from "react";
import { reportError, type ErrorReportPayload } from "@/lib/monitoring/report-error";

interface UseErrorReportingOptions {
  digest?: string;
  route?: string;
  locale?: string;
}

export function useErrorReporting(error: Error, options: UseErrorReportingOptions) {
  const reportedRef = React.useRef(false);

  React.useEffect(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;

    const payload: ErrorReportPayload = {
      name: error.name,
      message: error.message || "Unknown error",
      digest: options.digest,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
      route: options.route,
      locale: options.locale,
      source: "app-router",
      occurredAt: new Date().toISOString(),
    };

    reportError(payload);
  }, [error, options.digest, options.locale, options.route]);
}

