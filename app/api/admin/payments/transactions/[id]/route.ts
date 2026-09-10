import { connectDB } from "@/lib/db";
import { PaymentTransaction } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";

export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:payments:transactions:read", preset: "lenient" },
  },
  async ({ params }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Transaction");

    await connectDB();
    const transaction = await PaymentTransaction.findById(id).lean();
    if (!transaction) return notFoundResponse("Transaction");

    return successResponse(transaction);
  },
);
