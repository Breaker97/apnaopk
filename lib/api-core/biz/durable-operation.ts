import { createHash, randomUUID } from "node:crypto";
import type { OperationStatus } from "@/contracts/mobile/biz/v1/operations";
import { MobileApiError } from "@/lib/api-core/errors";
import type { BizWorkspaceGrant } from "./actor";

export type OperationResourceRef = OperationStatus["resources"][number];
export interface BizOperationBinding {
  actorId: string;
  workspace: "platform" | "vendor";
  /** Vendor identity is part of the workspace: staff reassigned to another vendor cannot replay it. */
  workspaceId: string;
  key: string;
  routeId: string;
  target: string;
  payloadHash: string;
}
export interface StoredBizOperation extends BizOperationBinding {
  id: string;
  state: OperationStatus["state"];
  token: string;
  leaseUntil: Date;
  updatedAt: Date;
  resources: OperationResourceRef[];
  checkpoint?: Record<string, unknown>;
  result?: unknown;
  failure?: { status: number; code: "VALIDATION_ERROR" | "CONFLICT"; message: string; reason?: string };
}
export interface BizOperationStore {
  /** Atomic insert; duplicate actor/key returns its existing binding, never replaces it. */
  open(binding: BizOperationBinding, token: string, leaseUntil: Date): Promise<{ operation: StoredBizOperation; owned: boolean }>;
  read(actorId: string, key: string): Promise<StoredBizOperation | null>;
  /** Only an expired lease may be taken; a resumed execution must reconcile first. */
  take(operation: StoredBizOperation, token: string, leaseUntil: Date): Promise<StoredBizOperation | null>;
  checkpoint(id: string, token: string, value: Record<string, unknown>, resources?: OperationResourceRef[]): Promise<void>;
  finish(id: string, token: string, result: unknown, resources: OperationResourceRef[]): Promise<StoredBizOperation>;
  unknown(id: string, token: string): Promise<StoredBizOperation>;
  fail(id: string, token: string, failure: NonNullable<StoredBizOperation["failure"]>): Promise<StoredBizOperation>;
}

function canonical(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
export function bizOperationBinding(input: {
  actorId: string; workspace: BizWorkspaceGrant; key: string | undefined; routeId: string; target: string; payload: unknown;
}): BizOperationBinding {
  if (!input.key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.key)) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "Send a UUID in the Idempotency-Key header.");
  }
  return {
    actorId: input.actorId, workspace: input.workspace.workspace,
    workspaceId: input.workspace.workspace === "vendor" ? input.workspace.vendor.id : "platform",
    key: input.key.toLowerCase(), routeId: input.routeId, target: input.target,
    payloadHash: createHash("sha256").update(JSON.stringify(canonical(input.payload))).digest("hex"),
  };
}
export function assertOperationBinding(existing: BizOperationBinding, wanted: BizOperationBinding): void {
  if (["actorId", "workspace", "workspaceId", "key", "routeId", "target", "payloadHash"].some((key) => existing[key as keyof BizOperationBinding] !== wanted[key as keyof BizOperationBinding])) {
    throw new MobileApiError(422, "IDEMPOTENCY_KEY_REUSED", "This key belongs to a different operation. Keep the original request or use a new key.");
  }
}
export function toOperationStatus(operation: StoredBizOperation): OperationStatus {
  return {
    key: operation.key, state: operation.state, routeId: operation.routeId,
    resources: operation.resources, updatedAt: operation.updatedAt.toISOString(),
    ...(operation.state === "pending" ? { retryAfterSeconds: 2 } : {}),
    ...(operation.state === "unknown" ? { reason: "OPERATION_OUTCOME_UNKNOWN" } : {}),
    ...(operation.failure?.reason ? { reason: operation.failure.reason } : {}),
  };
}
function unavailable(operation: StoredBizOperation): MobileApiError {
  return operation.state === "pending"
    ? new MobileApiError(409, "REQUEST_IN_PROGRESS", "This operation is still being processed.", { headers: { "Retry-After": "2" }, details: { operation: toOperationStatus(operation) } })
    : new MobileApiError(503, "SERVICE_UNAVAILABLE", "The outcome is not confirmed yet. Reconcile this operation before trying again.", { reason: "OPERATION_OUTCOME_UNKNOWN", headers: { "Retry-After": "2" }, details: { operation: toOperationStatus(operation) } });
}

/** Explicitly certified before any effect; a network/provider/database error must never use this class. */
export class DefiniteOperationFailure extends Error {
  constructor(readonly refusal: NonNullable<StoredBizOperation["failure"]>) { super(refusal.message); }
}
export interface BizOperationExecution {
  id: string;
  /** Stable across retries/restarts; pass to gateways and domain receipts. */
  effectKey: string;
  checkpoint?: Record<string, unknown>;
  remember(value: Record<string, unknown>, resources?: OperationResourceRef[]): Promise<void>;
}
type OperationReconciliation<T> =
  | { state: "succeeded"; data: T; resources: OperationResourceRef[] }
  | { state: "not_applied" }
  | { state: "pending" | "unknown" };

/**
 * New consequential handlers call this inside the ordinary request pipeline.
 * Persist domain receipts under effectKey before side effects. A stale/unknown
 * attempt never executes again unless reconcile proves that nothing applied.
 * Authorization runs on the request target AND every recorded result on every
 * call, including cached success and reconciliation; no stale data replay.
 */
export async function runDurableBizOperation<T>(input: {
  binding: BizOperationBinding; store: BizOperationStore;
  authorize(resources: readonly OperationResourceRef[]): Promise<void>;
  execute(operation: BizOperationExecution): Promise<{ data: T; resources: OperationResourceRef[] }>;
  reconcile(operation: BizOperationExecution, resources: readonly OperationResourceRef[]): Promise<OperationReconciliation<T>>;
  now?: () => Date;
}): Promise<{ data: T; operation: OperationStatus }> {
  const now = input.now ?? (() => new Date());
  await input.authorize([]);
  const token = randomUUID();
  const leaseUntil = new Date(now().getTime() + 10 * 60_000);
  const opened = await input.store.open(input.binding, token, leaseUntil);
  let operation = opened.operation;
  assertOperationBinding(operation, input.binding);
  await input.authorize(operation.resources);
  if (operation.state === "succeeded") return { data: operation.result as T, operation: toOperationStatus(operation) };
  if (operation.state === "failed") {
    const failure = operation.failure;
    throw new MobileApiError(failure?.status ?? 409, failure?.code ?? "CONFLICT", failure?.message ?? "This operation was refused.", { reason: failure?.reason ?? "OPERATION_FAILED", details: { operation: toOperationStatus(operation) } });
  }
  if (!opened.owned) {
    if (operation.leaseUntil.getTime() > now().getTime()) throw unavailable(operation);
    const taken = await input.store.take(operation, token, leaseUntil);
    if (!taken) throw unavailable(operation);
    operation = taken;
  }
  const execution: BizOperationExecution = {
    id: operation.id, effectKey: `biz:${operation.id}`, checkpoint: operation.checkpoint,
    remember: async (value, resources) => {
      await input.store.checkpoint(operation.id, token, value, resources);
      execution.checkpoint = value;
    },
  };
  try {
    if (!opened.owned) {
      const reconciled = await input.reconcile(execution, operation.resources);
      if (reconciled.state === "succeeded") {
        await input.authorize(reconciled.resources);
        operation = await input.store.finish(operation.id, token, reconciled.data, reconciled.resources);
        return { data: reconciled.data, operation: toOperationStatus(operation) };
      }
      if (reconciled.state !== "not_applied") {
        operation = await input.store.unknown(operation.id, token);
        throw unavailable(operation);
      }
    }
    const result = await input.execute(execution);
    await input.authorize(result.resources);
    operation = await input.store.finish(operation.id, token, result.data, result.resources);
    return { data: result.data, operation: toOperationStatus(operation) };
  } catch (error) {
    if (error instanceof DefiniteOperationFailure) {
      operation = await input.store.fail(operation.id, token, error.refusal);
      throw new MobileApiError(error.refusal.status, error.refusal.code, error.refusal.message, { reason: error.refusal.reason, details: { operation: toOperationStatus(operation) } });
    }
    // Persist uncertainty even for server exceptions. Never delete the receipt or
    // release monetary/inventory claims based only on a missing answer.
    await input.store.unknown(operation.id, token).catch(() => undefined);
    if (error instanceof MobileApiError && (error.code === "AUTHORIZATION_ERROR" || error.code === "NOT_FOUND" || error.code === "WORKSPACE_NOT_AVAILABLE" || error.code === "VENDOR_NOT_ACTIVE")) throw error;
    throw unavailable({ ...operation, state: "unknown" });
  }
}

/** Scoped polling cannot reveal a payload, customer data, or another operator's attempt. */
export async function readDurableBizOperation(input: {
  actorId: string; workspace: BizWorkspaceGrant; key: string; store: BizOperationStore;
  authorize(resources: readonly OperationResourceRef[]): Promise<void>;
}): Promise<OperationStatus> {
  await input.authorize([]);
  const operation = await input.store.read(input.actorId, input.key.toLowerCase());
  const workspaceId = input.workspace.workspace === "vendor" ? input.workspace.vendor.id : "platform";
  if (!operation || operation.workspace !== input.workspace.workspace || operation.workspaceId !== workspaceId) throw new MobileApiError(404, "NOT_FOUND", "Operation not found.");
  await input.authorize(operation.resources);
  return toOperationStatus(operation);
}
