/**
 * The email a guest entered at checkout, kept for the success page.
 *
 * A guest holds no session the invoice route could authenticate, so the
 * success page downloads their invoice through the public tracking endpoint
 * instead — which needs the order number plus the email the order was placed
 * with. The order number survives the payment redirect in the URL; the email
 * does not, and putting it there would leak it into history and Referer
 * headers. sessionStorage keeps it tab-local and drops it when the tab closes.
 */

const GUEST_CONTACT_KEY = "checkout_guest_email";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveGuestCheckoutEmail(email: string) {
  const normalized = email.trim();
  if (!normalized) return;
  try {
    storage()?.setItem(GUEST_CONTACT_KEY, normalized);
  } catch {
    // Storage full or blocked — the invoice button will fall back to a toast.
  }
}

export function readGuestCheckoutEmail(): string | null {
  try {
    return storage()?.getItem(GUEST_CONTACT_KEY) || null;
  } catch {
    return null;
  }
}
