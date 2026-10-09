import { OperationQuery, OperationStatus, OPERATION_REASONS } from "@/contracts/mobile/biz/v1/operations";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { toOperationStatus } from "@/lib/api-core/biz/durable-operation";
import { defineBizRoute } from "@/lib/api-core/registry";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { reconcileAbortedManualOrder } from "@/lib/api-core/biz/order-creation/reconcile-aborted";
import { authorizeBizOperation, operationNotFound } from "./access";

export const operationStatusRoute = defineBizRoute({
  id: "operations.status", method: "GET", path: "/operations", auth: "user", ...BIZ_ACCESS.workspace,
  cache: { kind: "private" }, rateLimit: { bucket: "biz:operations:read", preset: "lenient" },
  input: OperationQuery, output: OperationStatus, reasons: { values: OPERATION_REASONS },
  handler: async ({ input, workspace, scope, session, locale }) => {
    const operation = await mongoBizOperationStore.read(session.user.id, input.key.toLowerCase());
    if (!operation) throw operationNotFound();
    await authorizeBizOperation(operation, { actorId: session.user.id, workspace, scope, locale });
    const resolved = await reconcileAbortedManualOrder(operation);
    await authorizeBizOperation(resolved, { actorId: session.user.id, workspace, scope, locale });
    return OperationStatus.parse(toOperationStatus(resolved));
  },
});
