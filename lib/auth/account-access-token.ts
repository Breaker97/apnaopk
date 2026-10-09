import "server-only";

import { connectDB } from "@/lib/db";
import { PasswordReset, User } from "@/models";
import {
  tokenPurpose,
  type PasswordTokenPurpose,
} from "@/models/password-reset.model";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";

/**
 * What the reset page shows for a link before anyone types a password: whether
 * it still works, and whether it sets a first password or replaces one. A
 * banned account's link is reported as dead — the page then offers nothing a
 * banned shopper could use.
 */
export async function inspectAccountAccessToken(
  rawToken: string,
): Promise<{ valid: false } | { valid: true; purpose: PasswordTokenPurpose }> {
  await connectDB();
  const resetDoc = await PasswordReset.verifyToken(rawToken);
  if (!resetDoc) return { valid: false };
  const user = await User.findById(resetDoc.userId)
    .select("status")
    .lean<{ status?: string } | null>();
  if (!user || user.status === USER_ACCOUNT_STATUS.BANNED) return { valid: false };
  return { valid: true, purpose: tokenPurpose(resetDoc) };
}
