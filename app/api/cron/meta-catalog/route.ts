import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron/health";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { runMetaCatalogSync } from "@/lib/meta-catalog/sync-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Meta catalog live sync: sends the products that changed to Meta's Catalog
 * Batch API, checks the batches Meta is still ingesting, and moves the hourly
 * reconcile on (lib/meta-catalog/sync-worker.ts). Does nothing unless
 * Settings → Meta catalog is set to live sync with a catalog and a token, and
 * never contacts Meta in demo mode.
 */
export const GET = withCronRun("meta-catalog", async () => {
  if (isDemoModeEnabled()) {
    return NextResponse.json({ success: true, data: { skipped: "demo_mode" } });
  }
  const data = await runMetaCatalogSync();
  return NextResponse.json({ success: true, data });
});
