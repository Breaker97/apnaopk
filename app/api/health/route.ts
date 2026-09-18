import { NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Health probe used by the Coolify deployment. It verifies that both Next.js
 * and the MongoDB connection are ready to serve requests.
 */
export async function GET() {
  try {
    await connectDB();
    const database = mongoose.connection.db;
    if (!database) throw new Error("MongoDB connection is not ready");
    await database.admin().ping();

    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unhealthy" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
