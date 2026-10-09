/**
 * What the Email settings page works out from the fields as they are typed:
 * which setup guide fits the server, how its port is encrypted, and when Gmail
 * will not send as the From address. Pure, so the rules are tested apart from
 * the page.
 */

/** The setup guides, in the order the guide offers them. */
export const EMAIL_PROVIDERS = [
  "gmail",
  "zoho",
  "hosting",
  "brevo",
  "sendgrid",
  "ses",
  "other",
] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/**
 * The guide that fits a server name already typed in, or null while it is
 * blank. A cPanel host is named `mail.<domain>`; anything unrecognised gets
 * the general guide.
 */
export function detectEmailProvider(
  host: string | null | undefined,
): EmailProvider | null {
  const value = String(host ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value.includes("gmail") || value.includes("google")) return "gmail";
  if (value.includes("zoho")) return "zoho";
  if (value.includes("brevo") || value.includes("sendinblue")) return "brevo";
  if (value.includes("sendgrid")) return "sendgrid";
  if (value.includes("amazonaws")) return "ses";
  if (value.startsWith("mail.")) return "hosting";
  return "other";
}

/**
 * How a port is encrypted. The transport derives TLS from the port alone
 * (`resolveSmtpConfig`): 465 connects over TLS, 587 must upgrade with
 * STARTTLS, and any other port encrypts only if the server offers it.
 */
export function portEncryption(
  port: number | string | null | undefined,
): "tls" | "starttls" | "other" | null {
  const value = Number(port);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value === 465) return "tls";
  if (value === 587) return "starttls";
  return "other";
}

/**
 * Gmail sends as the account it signs in with unless the From address is one
 * of that account's "Send mail as" addresses. Mirrors the warning the test
 * email's success message gives (settings/test-email), shown before the test.
 */
export function needsGmailAlias(input: {
  host?: string | null;
  user?: string | null;
  fromEmail?: string | null;
}): boolean {
  const host = String(input.host ?? "").toLowerCase();
  const user = String(input.user ?? "").trim().toLowerCase();
  const from = String(input.fromEmail ?? "").trim().toLowerCase();
  return host.includes("gmail") && Boolean(from) && Boolean(user) && from !== user;
}

/**
 * The sender inboxes show, as `buildFromHeader` writes it: the From name or
 * the store's name, and the From email or the login.
 */
export function inboxSender(input: {
  fromName?: string | null;
  fromEmail?: string | null;
  user?: string | null;
  storeName: string;
}): string {
  const name = input.fromName?.trim() || input.storeName;
  const address = input.fromEmail?.trim() || input.user?.trim();
  return address ? `${name} <${address}>` : name;
}
