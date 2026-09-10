import { NextResponse } from "next/server";
import { z } from "zod";

// Shape of the browser's error report. Loose so a report never fails for an
// extra field, bounded so the endpoint cannot be used to log arbitrary blobs.
const ClientErrorReportSchema = z
  .object({
    message: z.string().max(2000).optional(),
    digest: z.string().max(200).optional(),
    route: z.string().max(500).optional(),
    locale: z.string().max(10).optional(),
    occurredAt: z.string().max(64).optional(),
    stack: z.string().max(8000).optional(),
  })
  .loose();

export async function POST(request: Request) {
  try {
    const parsed = ClientErrorReportSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const body = parsed.data;

    if (process.env.NODE_ENV !== "production") {
      console.error("client-error", body);
    } else {
      console.error("client-error", {
        message: body?.message,
        digest: body?.digest,
        route: body?.route,
        locale: body?.locale,
        occurredAt: body?.occurredAt,
      });
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

