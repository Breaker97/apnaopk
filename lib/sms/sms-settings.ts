import { ValidationError } from "@/lib/api/errors";
import { isKnownCountryCode } from "@/lib/intl/country-availability";
import { isPlainObject } from "@/lib/utils";

const TWILIO_ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
const TWILIO_MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-f]{32}$/i;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
/** Twilio alphanumeric sender IDs: 1–11 letters, digits and spaces, one letter at least. */
const ALPHANUMERIC_SENDER_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

/**
 * Shape checks for the SMS section. Whether the result can actually send
 * (credentials from here or `.env`, and a sender) is checked after the merge,
 * where the stored secrets are visible.
 *
 * `accountSid` and `authToken` are credentials: "" means keep the stored value
 * and null means clear it, so those two markers pass through untouched.
 */
export function validateSmsSettings(data: Record<string, unknown>) {
  if (data.enabled !== undefined && typeof data.enabled !== "boolean") {
    throw new ValidationError("SMS enabled must be true or false");
  }
  if (data.includeLinks !== undefined && typeof data.includeLinks !== "boolean") {
    throw new ValidationError("Include links must be true or false");
  }
  if (
    data.logRetentionDays !== undefined &&
    ![7, 30, 90].includes(Number(data.logRetentionDays))
  ) {
    throw new ValidationError("SMS log retention must be 7, 30 or 90 days");
  }
  if (data.logRetentionDays !== undefined) {
    data.logRetentionDays = Number(data.logRetentionDays);
  }

  if (data.defaultCountry !== undefined && data.defaultCountry !== null) {
    const code =
      typeof data.defaultCountry === "string"
        ? data.defaultCountry.trim().toUpperCase()
        : "";
    if (code && !isKnownCountryCode(code)) {
      throw new ValidationError("Default SMS country is not a known country");
    }
    data.defaultCountry = code;
  }

  if (data.twilio === undefined) return;
  if (!isPlainObject(data.twilio)) {
    throw new ValidationError("Twilio settings are invalid");
  }
  const twilio = data.twilio;

  if (typeof twilio.accountSid === "string" && twilio.accountSid.trim()) {
    const accountSid = twilio.accountSid.trim();
    if (!TWILIO_ACCOUNT_SID_PATTERN.test(accountSid)) {
      throw new ValidationError(
        "The Twilio Account SID starts with AC followed by 32 characters",
      );
    }
    twilio.accountSid = accountSid;
  }
  if (typeof twilio.authToken === "string" && twilio.authToken !== "") {
    const authToken = twilio.authToken.trim();
    if (!authToken || /\s/.test(authToken) || authToken.length > 128) {
      throw new ValidationError("The Twilio Auth Token is invalid");
    }
    twilio.authToken = authToken;
  }
  if (twilio.messagingServiceSid !== undefined && twilio.messagingServiceSid !== null) {
    const sid =
      typeof twilio.messagingServiceSid === "string"
        ? twilio.messagingServiceSid.trim()
        : "";
    if (sid && !TWILIO_MESSAGING_SERVICE_SID_PATTERN.test(sid)) {
      throw new ValidationError(
        "The Messaging Service SID starts with MG followed by 32 characters",
      );
    }
    twilio.messagingServiceSid = sid;
  }
  if (twilio.fromNumber !== undefined && twilio.fromNumber !== null) {
    const raw = typeof twilio.fromNumber === "string" ? twilio.fromNumber.trim() : "";
    // "+1 (415) 555-0100" is how numbers are copied out of the Twilio console.
    const from = raw.startsWith("+") ? `+${raw.replace(/\D/g, "")}` : raw;
    if (from && !E164_PATTERN.test(from) && !ALPHANUMERIC_SENDER_PATTERN.test(from)) {
      throw new ValidationError(
        "The sender must be a number with its country code (+15551234567) or a sender ID of up to 11 letters and digits",
      );
    }
    twilio.fromNumber = from;
  }
}
