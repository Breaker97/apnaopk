"use client";

export interface ErrorReportPayload {
  name?: string;
  message: string;
  digest?: string;
  stack?: string;
  route?: string;
  locale?: string;
  source: "app-router";
  occurredAt: string;
}

export function reportError(payload: ErrorReportPayload) {
  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/monitoring/error", blob);
      return;
    } catch {
      return;
    }
  }

  void fetch("/api/monitoring/error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

