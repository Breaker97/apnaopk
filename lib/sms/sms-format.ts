/**
 * The shapes Twilio's identifiers and senders take: checked when the SMS
 * settings are saved (lib/sms/sms-settings.ts), and as an admin types them.
 */

const TWILIO_ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
const TWILIO_MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-f]{32}$/i;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
/** Twilio alphanumeric sender IDs: 1–11 letters, digits and spaces, one letter at least. */
const ALPHANUMERIC_SENDER_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

export function isTwilioAccountSid(value: string): boolean {
  return TWILIO_ACCOUNT_SID_PATTERN.test(value.trim());
}

export function isMessagingServiceSid(value: string): boolean {
  return TWILIO_MESSAGING_SERVICE_SID_PATTERN.test(value.trim());
}

/** "+1 (415) 555-0100", as numbers are copied out of the Twilio console, as "+14155550100". */
export function normalizeSmsSender(raw: string): string {
  const value = raw.trim();
  return value.startsWith("+") ? `+${value.replace(/\D/g, "")}` : value;
}

/** A number with its country code, or a sender ID of up to 11 letters and digits. */
export function isValidSmsSender(raw: string): boolean {
  const sender = normalizeSmsSender(raw);
  return E164_PATTERN.test(sender) || ALPHANUMERIC_SENDER_PATTERN.test(sender);
}

/**
 * A name rather than a number. Nobody can reply to one, so a customer cannot
 * text STOP to it.
 */
export function isAlphanumericSender(raw: string): boolean {
  const sender = normalizeSmsSender(raw);
  return !E164_PATTERN.test(sender) && ALPHANUMERIC_SENDER_PATTERN.test(sender);
}
