/**
 * Expense receipts: where the evidence behind a cost is kept.
 *
 * Invoices, salary slips and bank transfer confirmations carry names, amounts
 * and account numbers. They used to go through the public media upload, which
 * put them on the public bucket and in the Media Library beside product
 * photos. New uploads land in PRIVATE storage and the row stores the KEY; the
 * only way to open one is the admin receipt route. Rows saved before this keep
 * their public URL and open as they always did, so both shapes are accepted
 * wherever a receipt is validated.
 *
 * Kept free of server imports: the form builds its View link in the browser.
 */

export const EXPENSE_RECEIPT_KEY_PREFIX = "expense-receipts/";

/** What a receipt may be: a photo of a paper receipt, or the PDF a biller sent. */
export const EXPENSE_RECEIPT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const EXPENSE_RECEIPT_ACCEPT = EXPENSE_RECEIPT_MIME_TYPES.join(",");

export const EXPENSE_RECEIPT_MAX_SIZE_MB = 10;

/** The admin route that serves a private receipt. */
export const EXPENSE_RECEIPT_ROUTE = "/api/admin/finance/expenses/receipts";

const SAFE_KEY_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * A private-storage key minted by the receipt upload route.
 *
 * The segment check is what keeps the receipt route scoped: "." and ".."
 * segments would let a crafted key climb out of the prefix on the local
 * provider and read other private files — vendor identity documents and
 * digital product deliverables live in the same store.
 */
export function isExpenseReceiptKey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith(EXPENSE_RECEIPT_KEY_PREFIX)) return false;
  if (value.length > 512) return false;
  return value
    .split("/")
    .every(
      (segment) =>
        SAFE_KEY_SEGMENT.test(segment) && segment !== "." && segment !== "..",
    );
}

/**
 * Anything a receipt field may store: a private key, or a legacy URL — an
 * http(s) address or a site-relative path, never `javascript:` or `data:`.
 */
export function isExpenseReceiptReference(value: unknown): boolean {
  if (typeof value !== "string" || !value || value.length > 1000) return false;
  if (isExpenseReceiptKey(value)) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Where "View" goes: a private key through the admin route, a legacy URL
 * straight to where it already lives.
 */
export function expenseReceiptViewUrl(reference: string): string {
  return isExpenseReceiptKey(reference)
    ? `${EXPENSE_RECEIPT_ROUTE}?key=${encodeURIComponent(reference)}`
    : reference;
}

/** The file type a key or URL ends in, which is all the list has to go on. */
export function isPdfReceipt(reference: string): boolean {
  return /\.pdf($|\?)/i.test(reference);
}
