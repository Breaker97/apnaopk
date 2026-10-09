import * as z from "zod";

/** A consequential tap, scoped to the operator and workspace. Never a queued offline write. */
export const OPERATION_STATES = ["pending", "unknown", "succeeded", "failed"] as const;
export const OPERATION_REASONS = [
  "OPERATION_OUTCOME_UNKNOWN", "OPERATION_RECONCILIATION_REQUIRED", "OPERATION_FAILED",
] as const;
export const OperationResource = z.object({
  kind: z.enum(["order", "product", "return", "refund", "upload", "customer"]),
  id: z.string(),
});
export type OperationResource = z.infer<typeof OperationResource>;
export const OperationStatus = z.object({
  key: z.string().uuid(),
  state: z.enum(OPERATION_STATES),
  routeId: z.string(),
  resources: z.array(OperationResource),
  updatedAt: z.string(),
  retryAfterSeconds: z.number().int().positive().optional(),
  reason: z.string().optional(),
});
export type OperationStatus = z.infer<typeof OperationStatus>;
export const OperationQuery = z.object({ key: z.string().uuid() });
export type OperationQuery = z.infer<typeof OperationQuery>;
