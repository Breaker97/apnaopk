/**
 * How long a register may keep selling after the server last authenticated it.
 *
 * The service worker now keeps the POS document (`public/sw.js`), so the
 * terminal opens with no connection — which is the point, and which also means
 * a tablet that walks out of the shop still shows a working till. This is the
 * bound on that.
 *
 * Be precise about what it is and is not. It is **not** a security boundary
 * against a determined attacker: the stamp lives in `localStorage` and anyone
 * with the device and a debugger can move it. The real protection is
 * server-side and already holds — an offline sale can only ever be committed by
 * replaying it against a live session, so a session that has been revoked
 * answers 401 and every sale rung up on a stolen tablet is refused, queue and
 * all. What this adds is the thing that protection cannot give: a till that
 * stops *looking* usable, so a device left in a taxi does not keep printing
 * receipts with the shop's name on them for a week.
 *
 * Twelve hours is one long shift. A cashier who starts a shift with the
 * connection already down has whatever the previous shift left, and any
 * successful server call during the shift renews it.
 *
 * A merchant-configurable window belongs in POS settings eventually — a market
 * stall and a jeweller want different answers. Left as a constant until
 * somebody asks, rather than shipping a setting nobody has an opinion about.
 */
const OFFLINE_SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;

const STAMP_KEY_PREFIX = "pos:last-authenticated";

function hasStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function stampKey(scope: string): string {
  return `${STAMP_KEY_PREFIX}:${scope}`;
}

/**
 * Record that the server has just authenticated this register.
 *
 * Called on a successful authenticated API response, never merely on the page
 * rendering: when the service worker serves the cached document the page
 * renders exactly as it does online, so "the terminal loaded" proves nothing
 * about the session. A 200 from the server does.
 */
export function markPOSAuthenticated(scope: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(stampKey(scope), String(Date.now()));
  } catch {
    // Storage full or blocked. The register falls back to "never authenticated
    // here", which locks rather than unlocks — the safe direction.
  }
}

export interface POSOfflineSessionState {
  /** Whether the register may still be used without a connection. */
  allowed: boolean;
  /** Milliseconds left in the window, 0 once it has closed. */
  remainingMs: number;
  /** When the server last authenticated this register, if ever. */
  lastAuthenticatedAt: Date | null;
}

export function readPOSOfflineSession(scope: string): POSOfflineSessionState {
  if (!hasStorage()) {
    // No storage means no stamp can ever be written, so refusing here would
    // lock a browser that is merely private-mode. Online use is unaffected;
    // this state is only consulted when the connection is already down.
    return { allowed: false, remainingMs: 0, lastAuthenticatedAt: null };
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(stampKey(scope));
  } catch {
    return { allowed: false, remainingMs: 0, lastAuthenticatedAt: null };
  }

  const stamp = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(stamp) || stamp <= 0) {
    return { allowed: false, remainingMs: 0, lastAuthenticatedAt: null };
  }

  const elapsed = Date.now() - stamp;
  // A stamp in the future means the device clock moved backwards — treat it as
  // current rather than as expired, since locking a working till over a clock
  // adjustment is the worse failure.
  const remainingMs = Math.max(0, OFFLINE_SESSION_WINDOW_MS - Math.max(0, elapsed));

  return {
    allowed: remainingMs > 0,
    remainingMs,
    lastAuthenticatedAt: new Date(stamp),
  };
}

export { OFFLINE_SESSION_WINDOW_MS };
