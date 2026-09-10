import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

/**
 * Better Auth Client Configuration
 * Client-side authentication utilities for React components
 */

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [twoFactorClient()],
});

// Export commonly used hooks and functions
export const { signIn, signUp, useSession, getSession } = authClient;

/**
 * Sign out, and take the register's cached page with it.
 *
 * The service worker keeps the POS document so a till survives a reload with
 * no connection (`public/sw.js`). On a counter tablet the next person to sign
 * in is often a different cashier — and on a multi-vendor install, a different
 * merchant — so a shell left behind could serve one tenant's server-rendered
 * catalogue to the next user the first time they open the register offline.
 * Signing out is the moment that stops being the same session, so it is the
 * moment the shell has to go.
 *
 * Wrapped here rather than at each call site because there are already half a
 * dozen of them and a future one would have no reason to know about any of
 * this.
 *
 * What is deliberately NOT cleared: the offline outbox. Those are completed
 * sales whose money is in the drawer and which the server has not accepted
 * yet. They are keyed by an idempotency key and belong to the store, not to
 * whoever happens to be signed in — dropping them at sign-out would destroy
 * takings. They sync on the next authenticated session.
 */
export const signOut: typeof authClient.signOut = async (...args) => {
  try {
    if (typeof caches !== "undefined") {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).pathname.startsWith("/__pos-shell")) {
            await cache.delete(request);
          }
        }
      }
    }
    if (typeof window !== "undefined" && window.localStorage) {
      // The offline session stamp is the other half: leaving it would let the
      // next person open a locked-out register inside somebody else's window.
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("pos:last-authenticated")) {
          window.localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Never block a sign-out on housekeeping — failing to clear a cache must
    // not leave the user signed in.
  }

  return authClient.signOut(...args);
};

// OAuth sign-in helpers
export const signInWithGoogle = (options?: {
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
}) => {
  return signIn.social({
    provider: "google",
    callbackURL: options?.callbackURL || "/",
    errorCallbackURL: options?.errorCallbackURL,
    newUserCallbackURL: options?.newUserCallbackURL,
  });
};

export const signInWithFacebook = (options?: {
  callbackURL?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
}) => {
  return signIn.social({
    provider: "facebook",
    callbackURL: options?.callbackURL || "/",
    errorCallbackURL: options?.errorCallbackURL,
    newUserCallbackURL: options?.newUserCallbackURL,
  });
};

/**
 * Sign out, then load the storefront root as a NEW document. A full
 * navigation on purpose, not `router.push`: every client store — cart,
 * wishlist, POS drafts, the app-settings snapshot — still holds the
 * signed-out user's data, and only a fresh document drops all of it at once.
 */
export async function signOutAndReload(locale: string): Promise<void> {
  await signOut();
  window.location.assign(new URL(`/${locale}`, window.location.origin).href);
}
