import "server-only";
import { Types } from "mongoose";
import * as z from "zod";
import { connectDB } from "@/lib/db";
import { User, Vendor } from "@/models";
import { AccountEmailJob, type AccountEmailSkipCounts } from "@/models/account-email-job.model";
import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { getSettingsLean } from "@/models/settings.model";
import { recentAccountAccessEmails } from "@/lib/auth/account-access";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";

const Selection = z.object({ vendorIds: z.array(z.string().refine(id => Types.ObjectId.isValid(id))).min(1).max(500) }).strict();
export function parseVendorEmailSelection(body: unknown): string[] {
  const parsed = Selection.safeParse(body);
  if (!parsed.success) throw new ValidationError("Select up to 500 vendors with valid IDs.");
  return parsed.data.vendorIds;
}
export async function resolveVendorEmailRecipients(vendorIds: string[]) {
  await connectDB();
  const settings = await getSettingsLean();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const stores = await Vendor.find({ _id: { $in: vendorIds } }).select("userId status").lean();
  const users = await User.find({ _id: { $in: stores.map(store => store.userId) } }).select("email status").lean();
  const byId = new Map(users.map(user => [String(user._id), user]));
  const skipped: AccountEmailSkipCounts = {};
  const skip = (reason: keyof AccountEmailSkipCounts) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const candidates = new Map<string, { userId: string; email: string; locale: string }>();
  const routing = await getLocaleRouting();
  for (const store of stores) {
    const user = byId.get(String(store.userId));
    if (!user?.email?.trim()) { skip("noEmail"); continue; }
    if (user.status === USER_ACCOUNT_STATUS.BANNED) { skip("banned"); continue; }
    if ((user.status && user.status !== USER_ACCOUNT_STATUS.ACTIVE) || store.status !== VENDOR_STATUS.APPROVED) { skip("inactive"); continue; }
    const email = user.email.trim().toLowerCase();
    if (candidates.has(email)) { skip("duplicate"); continue; }
    candidates.set(email, { userId: String(user._id), email, locale: routing.storeDefault });
  }
  const emails = [...candidates.keys()];
  const [recent, queued] = await Promise.all([
    recentAccountAccessEmails(emails),
    AccountEmailJob.distinct("email", { email: { $in: emails }, status: { $in: ["pending", "processing"] } }),
  ]);
  const busy = new Set([...recent, ...queued]);
  const recipients = [...candidates.values()].filter(recipient => {
    if (busy.has(recipient.email)) { skip("recent"); return false; }
    return true;
  });
  return { matched: stores.length, recipients, skipped };
}
