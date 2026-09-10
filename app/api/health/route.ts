import { NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Container health probe. A successful HTTP response proves both that Next.js
 * is accepting requests and that MongoDB can answer a round trip.
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
