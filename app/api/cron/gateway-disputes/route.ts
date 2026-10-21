import { NextResponse } from "next/server";
import { syncGatewayDisputes } from "@/lib/payments/gateway-disputes";
import { withCronRun } from "@/lib/cron/health";
import {
  summarizeGatewayReconciliation,
  type CronRunOutcome,
} from "@/lib/cron/reconciliation-outcome";

/**
 * Hourly: ask every gateway with credentials about its disputes.
 *
 * The webhooks are the fast path; this is the one that cannot be missed. A
 * gateway whose webhook was never set up, is not subscribed to its dispute
 * events, or dropped a delivery still has its chargebacks recorded, its won
 * disputes given back and its fees booked within the hour. A gateway with no
 * credentials yet is reported as not configured, and synced from the first run
 * after they are added.
 *
 * Refunds ride the same run, for the same reason: a refund made in a
 * gateway's own dashboard, or one that failed days after it went, reaches the
 * books only through a webhook — see `syncGatewayRefunds`.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const GET = withCronRun(
  "gateway-disputes",
  async () => {
    // Each worker establishes its own DB connection. A phase's setup/import
    // failure must also leave the other recovery paths available.
    const errors: Partial<
      Record<"disputes" | "refunds" | "paypalReviews", string>
    > = {};
    const run = async <T>(
      phase: keyof typeof errors,
      work: () => Promise<T>,
    ) => {
      try {
        return await work();
      } catch (error) {
        errors[phase] = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 300);
        console.error(`Gateway reconciliation ${phase} phase failed:`, error);
        return undefined;
      }
    };
    const disputes = await run("disputes", () => syncGatewayDisputes());
    const refunds = await run("refunds", async () => {
      const { syncGatewayRefunds } = await import(
        "@/lib/payments/gateway-refund-sync"
      );
      return syncGatewayRefunds();
    });
    const paypalReviews = await run("paypalReviews", async () => {
      const { recoverPayPalMatchReviews } = await import(
        "@/lib/orders/order-refund-sync"
      );
      return recoverPayPalMatchReviews();
    });
    const reconciliation = summarizeGatewayReconciliation({
      disputes,
      refunds,
      paypalReviews,
      errors,
    });
    if (reconciliation.status === "failed")
      console.error("Gateway reconciliation incomplete:", reconciliation);
    else if (reconciliation.status === "deferred")
      console.info("Gateway reconciliation deferred:", reconciliation);
    return NextResponse.json(
      {
        invoked: true,
        success: reconciliation.complete,
        reconciliation,
        data: { disputes, refunds, paypalReviews },
        ...(Object.keys(errors).length ? { errors } : {}),
      },
      { status: reconciliation.status === "failed" ? 503 : 200 },
    );
  },
  {
    outcome: async (response) =>
      (await response.clone().json()).reconciliation as CronRunOutcome,
  },
);
