import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { FinanceOperation } from "@/models/finance-operation.model";
import { connectDB } from "@/lib/db";
import { getTransactionSupport } from "@/lib/db-transaction";

export const GET = withApi<{ id: string }>(
  { auth: "admin", rateLimit: { action: "admin:finance:operations", preset: "lenient" } },
  async ({ params }) => {
    if (!isValidObjectId(params.id)) return notFoundResponse("Operation");
    await connectDB();
    const operation = await FinanceOperation.findById(params.id).select("state action sourceId attempts nextAttemptAt createdAt updatedAt").lean();
    if (!operation) return notFoundResponse("Operation");
    return successResponse({ ...operation, transactions: await getTransactionSupport(), message: operation.state === "conflict" ? "Bookkeeping needs review" : undefined });
  },
);
