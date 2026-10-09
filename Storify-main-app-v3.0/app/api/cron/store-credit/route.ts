import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withCronRun } from "@/lib/cron/health";
import {
  expireStoreCredit,
  reconcileStoreCreditHolds,
} from "@/lib/store-credit/store-credit";

/**
 * Store credit's upkeep (R8): lots past their expiry date come out of the
 * balance, and credit held for checkouts is settled by what became of their
 * order — see `reconcileStoreCreditHolds`. Hourly, so a checkout the shopper
 * walked away from gives its credit back within a few hours.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const GET = withCronRun("store-credit", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectDB();
  const expired = await expireStoreCredit({ limit: 500 });
  const holds = await reconcileStoreCreditHolds({ limit: 500 });
  return NextResponse.json({ success: true, data: { expired, holds } });
});
