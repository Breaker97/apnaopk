import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  getMtnMomoCredentials,
  getMtnMomoRequestToPayStatus,
  getMtnMomoTransactionState,
  MtnMomoApiError,
} from "@/lib/payments/mtn-momo";
import { finalizeMtnMomoOrder } from "@/lib/payments/mtn-momo-orders";
import { resolveMtnMomoCredentials } from "@/lib/settings/credentials";
import { isPlatformPaymentReference } from "@/models/platformPayment.model";
import {
  findPlatformPaymentByReference,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
import { z } from "zod";

type MtnMomoCallbackBody = {
  externalId?: string;
  status?: string;
  financialTransactionId?: string;
  amount?: string;
  currency?: string;
};

function readField(value: unknown): string | undefined {
  const str = String(value ?? "").trim();
  // Our identifiers are short (an order id or a prefix-marked reference);
  // anything longer is not one of ours and not worth a database query.
  return str.length && str.length <= 100 ? str : undefined;
}

async function readCallback(
  request: NextRequest,
): Promise<MtnMomoCallbackBody> {
  try {
    const body = CallbackBodySchema.parse(await request.json()) as MtnMomoCallbackBody;
    return {
      externalId: readField(body?.externalId),
      status: readField(body?.status),
      financialTransactionId: readField(body?.financialTransactionId),
      amount: readField(body?.amount),
      currency: readField(body?.currency),
    };
  } catch {
    return {};
  }
}

/**
 * MTN MoMo's server-to-server callback.
 *
 * The weakest webhook in the codebase: delivered once, unsigned, with no
 * shared secret and no retries. Its body identifies the transaction (the
 * `externalId` we set to our own order id / platform reference) and nothing
 * more — the only authority is re-fetching the status under our stored
 * X-Reference-Id. Because MTN never retries, "cannot answer" is logged loudly
 * and acknowledged rather than 500'd: the verify poll and the reconcile cron
 * are the paths that actually recover a missed one.
 */
async function handleMtnMomoCallback(request: NextRequest) {
  const payload = await readCallback(request);
  const externalId = payload.externalId;
  const status = String(payload.status || "").toUpperCase();

  if (!externalId || !status) {
    return NextResponse.json(
      { success: false, message: "Missing external id or status" },
      { status: 400 },
    );
  }

  // Non-terminal states carry no money and need no action; acknowledging them
  // before any lookup keeps the handler cheap on the one delivery MTN will
  // ever make. `CREATED` is included because that — not the documented
  // `PENDING` — is what the platform actually reports for an unfinished
  // request.
  if (status === "PENDING" || status === "CREATED") {
    return NextResponse.json({ success: true });
  }

  try {
    await connectDB();

    // Vendor→platform payments (boosts, subscriptions, commission) use this
    // callback too; their externalId is our prefix-marked reference and never
    // exists on an Order, so dispatch before the order gate.
    if (isPlatformPaymentReference(externalId)) {
      const platformPayment = await findPlatformPaymentByReference(externalId);
      if (!platformPayment) {
        console.error(
          "MTN MoMo callback for an unknown platform reference:",
          externalId,
        );
        return NextResponse.json({ success: true });
      }
      const settings = await getSettings();
      await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({ success: true });
    }

    // externalId was set to the order's own id at request time. Guarding the
    // cast keeps a garbage callback from throwing before the log line.
    const order = isValidObjectId(externalId)
      ? await Order.findOne({
          paymentMethod: "mtn_momo",
          _id: externalId,
        }).select("mtnMomoReferenceId")
      : null;

    if (!order || !order.mtnMomoReferenceId) {
      console.error("MTN MoMo callback for an unknown order:", externalId);
      return NextResponse.json({ success: true });
    }

    const settings = await getSettings();
    const resolved = resolveMtnMomoCredentials(settings.payment?.mtn_momo);
    const creds = getMtnMomoCredentials(resolved);

    // Never trust the callback body — re-fetch the authoritative status under
    // the reference we minted, and let the finalizer do the amount/currency
    // gate against what MTN reports.
    let transaction;
    try {
      transaction = await getMtnMomoRequestToPayStatus({
        creds,
        referenceId: order.mtnMomoReferenceId,
      });
    } catch (err) {
      // A 404 here means MTN cannot answer for the reference yet (or ever);
      // either way there is nothing to finalize and nothing a retry from MTN
      // would fix — it will not retry.
      if (err instanceof MtnMomoApiError && err.httpStatus === 404) {
        console.error(
          "MTN MoMo callback for a reference the status endpoint cannot find:",
          order.mtnMomoReferenceId,
        );
        return NextResponse.json({ success: true });
      }
      throw err;
    }

    if (getMtnMomoTransactionState(transaction) === "completed") {
      await finalizeMtnMomoOrder({
        referenceId: order.mtnMomoReferenceId,
        transaction,
        mode: creds.mode,
        settings,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to process MTN MoMo callback:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process callback" },
      { status: 500 },
    );
  }
}

// MTN documents the delivery as a PUT; POST is accepted too because parts of
// the platform (and the sandbox) have been observed sending either.
export const PUT = handleMtnMomoCallback;
// Server-to-server callback: only "is this a JSON object" is checked here,
// the fields are read defensively below and the signature/verify step decides.
const CallbackBodySchema = z.object({}).loose();

export const POST = handleMtnMomoCallback;
