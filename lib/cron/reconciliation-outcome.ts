/** Explicit completion reporting, opt-in so older cron jobs keep their contract. */
export interface CronRunOutcome {
  status: "ok" | "failed" | "deferred" | "not_configured";
  complete: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

interface SyncReport {
  status: "synced" | "continuing" | "failed" | "not_configured";
  checked?: number;
  failed?: number;
  busy?: number;
  pending?: number;
  due?: number;
  discoveryComplete?: boolean;
  error?: string;
  failureDetails?: Array<{ recordId: string; error: string }>;
}

export interface ReconciliationComponent {
  scope: "disputes" | "refunds" | "paypalReviews";
  gateway?: string;
  status: CronRunOutcome["status"];
  reasons: string[];
  checked: number;
  failed: number;
  busy: number;
  pending: number;
  due: number;
  error?: string;
  failureDetails?: Array<{ recordId: string; error: string }>;
}

/** Failure takes precedence over deferred work, regardless of provider status. */
export function summarizeGatewayReconciliation(input: {
  disputes?: Record<string, SyncReport>;
  refunds?: Record<string, SyncReport>;
  paypalReviews?: {
    checked: number;
    completed: number;
    busy: number;
    failed: number;
    pending?: number;
    failureDetails?: SyncReport["failureDetails"];
  };
  errors: Partial<Record<ReconciliationComponent["scope"], string>>;
}): CronRunOutcome {
  const components: ReconciliationComponent[] = [];
  const add = (
    scope: ReconciliationComponent["scope"],
    report: SyncReport,
    gateway?: string,
  ) => {
    const failed = report.failed ?? 0;
    const busy = report.busy ?? 0;
    const pending = report.pending ?? 0;
    const due = report.due ?? 0;
    const reasons: string[] = [];
    if (report.status === "failed")
      reasons.push(gateway ? "gateway_failure" : "phase_failure");
    if (failed) reasons.push("record_failure");
    if (busy) reasons.push("busy");
    if (pending) reasons.push("pending_reconciliation");
    if (due) reasons.push("due_backlog");
    if (report.discoveryComplete === false)
      reasons.push("incomplete_pagination");
    if (report.status === "continuing" && !reasons.length)
      reasons.push("continuation");
    const status =
      report.status === "failed" || failed > 0
        ? "failed"
        : report.status === "not_configured"
          ? "not_configured"
          : reasons.length
            ? "deferred"
            : "ok";
    components.push({
      scope,
      ...(gateway ? { gateway } : {}),
      status,
      reasons,
      checked: report.checked ?? 0,
      failed,
      busy,
      pending,
      due,
      ...(report.error ? { error: report.error.slice(0, 300) } : {}),
      ...(report.failureDetails?.length
        ? {
            failureDetails: report.failureDetails
              .slice(0, 5)
              .map(({ recordId, error }) => ({
                recordId: recordId.slice(0, 200),
                error: error.slice(0, 300),
              })),
          }
        : {}),
    });
  };
  for (const scope of ["disputes", "refunds"] as const) {
    if (input.errors[scope] !== undefined) {
      add(scope, { status: "failed", error: input.errors[scope] });
    } else {
      for (const [gateway, report] of Object.entries(input[scope] ?? {}))
        add(scope, report, gateway);
    }
  }
  if (input.errors.paypalReviews !== undefined)
    add("paypalReviews", {
      status: "failed",
      error: input.errors.paypalReviews,
    });
  else if (input.paypalReviews)
    add("paypalReviews", { ...input.paypalReviews, status: "synced" });

  const failures = components.filter(
    (component) => component.status === "failed",
  );
  const configured = components.some(
    (component) => component.gateway && component.status !== "not_configured",
  );
  const status = failures.length
    ? "failed"
    : components.some((component) => component.status === "deferred")
      ? "deferred"
      : !configured && !input.paypalReviews?.checked
        ? "not_configured"
        : "ok";
  const error = failures
    .map((component) => {
      const label = component.gateway
        ? `${component.scope}/${component.gateway}`
        : component.scope;
      const records = component.failureDetails
        ?.map((failure) => `${failure.recordId}: ${failure.error}`)
        .join("; ");
      return `${label}: ${[component.error, component.failed ? `${component.failed} record(s) failed` : undefined, records].filter(Boolean).join("; ") || "reconciliation failed"}`;
    })
    .join(" | ");
  return {
    status,
    complete: status === "ok",
    ...(error ? { error } : {}),
    details: { components },
  };
}
