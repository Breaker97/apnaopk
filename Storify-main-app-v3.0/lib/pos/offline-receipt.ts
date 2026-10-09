/**
 * Receipt numbering for a sale taken while the connection was down.
 *
 * `generatePosOrderNumber` runs on the server and needs the database to keep
 * the sequence gapless, so an offline sale has no real order number yet. It
 * still has a customer standing at the counter waiting for a receipt, and that
 * receipt is what they will bring back for a return or an exchange — so the
 * number printed on it has to be findable afterwards.
 *
 * Hence a provisional number, printed now and stored on the order at sync time
 * alongside the real one. The alternative — reserving a block of server numbers
 * in advance — reads cleaner until a terminal is lost or reset mid-block, at
 * which point the sequence has a hole that someone has to explain to a tax
 * auditor.
 *
 * The terminal prefix is what keeps two counters from both printing `0007`.
 */

const TERMINAL_ID_KEY = "pos:terminal-id";
const SEQUENCE_KEY_PREFIX = "pos:offline-receipt-seq";

function hasStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

/**
 * A stable per-browser terminal id, created on first use.
 *
 * Deliberately random rather than derived from anything about the device: it
 * only has to be distinct from the other registers in the same shop, and a
 * fingerprint would be both weaker at that and more than we need to know.
 */
function getTerminalId(): string {
  if (!hasStorage()) return "T0";

  const existing = window.localStorage.getItem(TERMINAL_ID_KEY);
  if (existing) return existing;

  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 4)
      : Math.random().toString(36).slice(2, 6);
  const id = `T${random.toUpperCase()}`;
  window.localStorage.setItem(TERMINAL_ID_KEY, id);
  return id;
}

/**
 * The next provisional receipt number for this terminal and location.
 *
 * The counter is per location as well as per terminal, so moving a tablet
 * between counters cannot make it reissue numbers it has already printed.
 */
export function nextLocalReceiptNumber(scope: string): string {
  const terminal = getTerminalId();
  if (!hasStorage()) return `${terminal}-0001`;

  const key = `${SEQUENCE_KEY_PREFIX}:${scope}`;
  const current = Number.parseInt(
    window.localStorage.getItem(key) || "0",
    10,
  );
  const next = Number.isFinite(current) && current > 0 ? current + 1 : 1;
  window.localStorage.setItem(key, String(next));

  return `${terminal}-${String(next).padStart(4, "0")}`;
}
