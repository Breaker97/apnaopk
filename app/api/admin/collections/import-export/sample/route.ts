import { connectDB } from "@/lib/db";
import { withApi } from "@/lib/api/handler";
import { collectionImportSampleResponse } from "@/lib/catalog/collection-import-sample";

/**
 * GET /api/admin/collections/import-export/sample
 * A sample import file with one manual and one automated collection, the
 * manual one filled with this store's own products, for merchants to copy the
 * format from.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:collections:import-sample", preset: "lenient" },
  },
  async () => {
    await connectDB();
    return collectionImportSampleResponse();
  },
);
