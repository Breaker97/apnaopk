import { createHmac, timingSafeEqual } from "node:crypto";
import type { ResolvedTwilioConfig } from "@/lib/settings/credentials";

/**
 * Twilio's Programmable Messaging API, spoken directly over `fetch`.
 *
 * Two calls are all SMS notifications need — create a message, and check the
 * signature on the delivery receipt Twilio posts back — so this deliberately
 * does not pull in the `twilio` SDK (a large dependency tree for two requests),
 * the same choice the Meta, Telegram and Expo push clients made.
 */

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
/** One send may not hold a cron batch or a request's `after()` hostage. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Twilio refuses longer bodies outright (error 21617). */
export const TWILIO_MAX_BODY_LENGTH = 1600;

/**
 * Error codes whose plain meaning an admin needs, in the words they need it.
 * Twilio's own messages name parameters ("The 'To' number…") rather than what
 * to do, and the delivery log is where an admin reads them.
 */
const TWILIO_ERROR_HINTS: Record<number, string> = {
  20003: "Twilio rejected the Account SID or Auth Token.",
  20404: "Twilio could not find this account — check the Account SID.",
  21211: "The recipient's phone number is not valid.",
  21408:
    "Your Twilio account is not allowed to text this country. Enable it under Messaging → Settings → Geo permissions.",
  21606: "The From number cannot send SMS to this destination.",
  21608:
    "Twilio trial accounts can only text verified numbers. Verify this number in the Twilio console, or upgrade the account.",
  21610: "The recipient replied STOP and has opted out of texts from this number.",
  21612: "Twilio cannot reach this number by SMS from the configured sender.",
  21614: "The recipient's number is not a mobile number.",
  21659: "The From number is not a Twilio number on this account.",
  21703: "The Messaging Service has no sender that can text this number.",
  30003: "The handset was unreachable.",
  30004: "The message was blocked by the recipient or their carrier.",
  30005: "The destination number is unknown or no longer in service.",
  30006: "The number is a landline or its carrier cannot receive SMS.",
  30007: "The carrier filtered the message as spam.",
  30008: "The carrier could not deliver the message.",
  30034:
    "US carriers block texts from numbers not registered for A2P 10DLC. Register the sender in the Twilio console.",
};

export function describeTwilioError(
  code: number | string | undefined,
  fallback?: string,
): string {
  const numeric = typeof code === "string" ? Number(code) : code;
  const hint = numeric ? TWILIO_ERROR_HINTS[numeric] : undefined;
  const base = hint || fallback || "Twilio could not send the message.";
  return numeric ? `${base} (Twilio error ${numeric})` : base;
}

export class TwilioApiError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  /** Twilio's own error code (21211, 21610 …) when it sent one. */
  readonly code?: number;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    status: number;
    code?: number;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "TwilioApiError";
    this.status = params.status;
    this.code = params.code;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }

  /**
   * Whether sending the same request again can never succeed. Throttling and
   * Twilio's own outages recover by waiting; a bad number, an opted-out
   * recipient or a rejected credential do not — and retrying them only fills
   * the log with the same failure.
   */
  get permanent(): boolean {
    if (this.status === 0 || this.status === 429 || this.status >= 500) {
      return false;
    }
    return this.status >= 400;
  }
}

function basicAuth(config: Pick<ResolvedTwilioConfig, "accountSid" | "authToken">) {
  return `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
}

interface TwilioMessageResource {
  sid?: string;
  status?: string;
  num_segments?: string | number;
}

interface TwilioErrorBody {
  code?: number;
  message?: string;
}

/**
 * Create one outbound SMS. Resolves with Twilio's message SID once Twilio has
 * accepted it — acceptance, not delivery: the carrier's verdict arrives later
 * at `statusCallback`.
 */
export async function sendTwilioMessage(
  config: ResolvedTwilioConfig,
  message: { to: string; body: string; statusCallback?: string },
): Promise<{ sid: string; segments?: number }> {
  const form = new URLSearchParams();
  form.set("To", message.to);
  form.set("Body", message.body.slice(0, TWILIO_MAX_BODY_LENGTH));
  // A Messaging Service picks the sender itself (geo-matching, sticky sender,
  // opt-out handling), so when one is configured it wins over a bare number.
  if (config.messagingServiceSid) {
    form.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (config.fromNumber) {
    form.set("From", config.fromNumber);
  }
  // Swaps look-alike Unicode (curly quotes, long dashes) for GSM-7 characters.
  // One stray “ turns a whole message into UCS-2, which fits 70 characters per
  // segment instead of 160 — and is billed accordingly.
  form.set("SmartEncoded", "true");
  if (message.statusCallback) form.set("StatusCallback", message.statusCallback);

  let response: Response;
  try {
    response = await fetch(
      `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(config),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new TwilioApiError({
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "Twilio did not answer in time."
          : `Could not reach Twilio: ${error instanceof Error ? error.message : "network error"}`,
      status: 0,
    });
  }

  const payload = (await response.json().catch(() => ({}))) as
    | (TwilioMessageResource & TwilioErrorBody)
    | undefined;

  if (!response.ok || !payload?.sid) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new TwilioApiError({
      message: describeTwilioError(payload?.code, payload?.message),
      status: response.ok ? 502 : response.status,
      code: typeof payload?.code === "number" ? payload.code : undefined,
      retryAfterSeconds:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    });
  }

  const segments = Number(payload.num_segments);
  return {
    sid: payload.sid,
    segments: Number.isFinite(segments) && segments > 0 ? segments : undefined,
  };
}

/**
 * The value Twilio puts in `X-Twilio-Signature`: HMAC-SHA1 of the exact URL it
 * called followed by every POST parameter, sorted by name, as name+value with
 * no separators; keyed with the account's Auth Token; base64.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
): string {
  const keys = [...new Set(params.keys())].sort();
  let data = url;
  for (const key of keys) {
    for (const value of params.getAll(key).sort()) data += key + value;
  }
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/**
 * Whether a webhook really came from Twilio. The URL must be the one Twilio
 * was given, which behind a proxy is not `request.url` — so callers pass every
 * spelling the public URL can have and any one matching is enough.
 */
export function isValidTwilioSignature(params: {
  authToken: string;
  signature: string | null;
  urls: string[];
  body: URLSearchParams;
}): boolean {
  if (!params.signature) return false;
  const received = Buffer.from(params.signature);
  return params.urls.some((url) => {
    const expected = Buffer.from(
      computeTwilioSignature(params.authToken, url, params.body),
    );
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
