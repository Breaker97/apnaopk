import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  startMetaCatalogSending,
  testMetaCatalogConnection,
} from "@/lib/meta-catalog/live-connection";
import { metaCatalogPageState } from "@/lib/meta-catalog/page-state";

/**
 * POST /api/admin/meta-catalog/live/test
 * Read the catalog's name with the saved catalog ID and token. A working test
 * lifts a pause and sends what changed meanwhile.
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:meta-catalog:test", preset: "strict" },
  },
  async () => {
    const test = await testMetaCatalogConnection();
    if (test.ok) await startMetaCatalogSending();
    return successResponse({ ...(await metaCatalogPageState()), test });
  },
);
