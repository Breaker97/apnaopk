import { createHmac } from "crypto";
import type { ISettings } from "@/models/settings.model";
import { resolveSmtpConfig, resolveSmtpFromEmail } from "@/lib/settings/credentials";

export function getSmtpConfigurationFingerprint(
  settings: Pick<ISettings, "email">,
): string | null {
  const config = resolveSmtpConfig(settings);
  if (!config) return null;

  const signingKey =
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!signingKey) return null;

  const payload = JSON.stringify({
    host: config.host.trim().toLowerCase(),
    port: config.port,
    secure: config.secure,
    user: config.auth.user.trim().toLowerCase(),
    password: config.auth.pass,
    from: resolveSmtpFromEmail(settings)?.trim().toLowerCase() || "",
  });

  return createHmac("sha256", signingKey).update(payload).digest("hex");
}

export function isCurrentSmtpConfigurationVerified(
  settings: Pick<ISettings, "email" | "security">,
): boolean {
  const currentFingerprint = getSmtpConfigurationFingerprint(settings);
  return Boolean(
    currentFingerprint &&
      settings.security?.smtpVerificationFingerprint === currentFingerprint &&
      settings.security?.smtpVerifiedAt,
  );
}
