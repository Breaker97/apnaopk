import { DIGITAL_ASSET_KEY_ROOT } from "@/lib/products/digital-assets";
import { VENDOR_DOCUMENT_KEY_PREFIX } from "@/lib/vendors/vendor-documents";
import { EXPENSE_RECEIPT_KEY_PREFIX } from "@/lib/finance/expense-receipts";

/**
 * Where private files' keys start: every `uploadPrivateFile` caller writes
 * under one of these — digital deliverables, vendor identity documents,
 * expense receipts. Public media keys start with the storage path prefix
 * ("uploads/" unless changed), so the two sets never meet, which is how
 * `db:migrate private-storage` finds the private files in a shared bucket.
 */
export const PRIVATE_STORAGE_PREFIXES: readonly string[] = [
  DIGITAL_ASSET_KEY_ROOT,
  VENDOR_DOCUMENT_KEY_PREFIX,
  EXPENSE_RECEIPT_KEY_PREFIX,
];

/**
 * Whether a key names public media: inside the storage path prefix, outside
 * every private prefix, and made of real folder names — no empty, "." or ".."
 * segment, no backslash. What the Media Library may delete by key.
 */
export function isPublicMediaKey(key: string, pathPrefix: string): boolean {
  if (!key || key.length > 1024 || !pathPrefix) return false;
  if (!key.startsWith(pathPrefix) || key.includes("\\")) return false;
  if (PRIVATE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return false;
  }
  return key
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
