import { NextRequest, NextResponse } from "next/server";
import * as z from "zod";
import { RateLimitError } from "@/lib/api/errors";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { readCappedBody } from "@/lib/storage/fetch-stored-file";

// Shape of the browser's error report (lib/monitoring/report-error.ts).
// Unknown fields are dropped rather than refused, so a report never fails for
// an extra field — and never carries one into the log either.
const ClientErrorReportSchema = z.object({
  name: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  digest: z.string().max(200).optional(),
  route: z.string().max(500).optional(),
  locale: z.string().max(10).optional(),
  source: z.string().max(50).optional(),
  occurredAt: z.string().max(64).optional(),
  stack: z.string().max(8000).optional(),
});

/** A report is a few kilobytes; a body past this is not one. */
const MAX_REPORT_BYTES = 16 * 1024;

/**
 * Text for one log line: a control character — a newline above all — would
 * let a report write log lines of its own.
 */
function oneLine(value: string | undefined): string | undefined {
  return value?.replace(/[\u0000-\u001f\u007f]+/g, " ");
}

/**
 * POST /api/monitoring/error — how a shopper's browser reports a crash.
 * Anyone can post here, so each address gets an allowance and a body is read
 * only up to a few kilobytes.
 */
export async function POST(request: NextRequest) {
  try {
    await rateLimitByIP(request, "lenient");
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }
    throw error;
  }

  let report: z.infer<typeof ClientErrorReportSchema>;
  try {
    const raw = await readCappedBody(request, MAX_REPORT_BYTES).catch(() => null);
    if (!raw) return NextResponse.json({ ok: false }, { status: 413 });
    const parsed = ClientErrorReportSchema.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    report = parsed.data;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (process.env.NODE_ENV !== "production") {
    console.error("client-error", report);
  } else {
    console.error("client-error", {
      name: oneLine(report.name),
      message: oneLine(report.message),
      digest: oneLine(report.digest),
      route: oneLine(report.route),
      locale: oneLine(report.locale),
      occurredAt: oneLine(report.occurredAt),
    });
  }

  return NextResponse.json({ ok: true });
}
