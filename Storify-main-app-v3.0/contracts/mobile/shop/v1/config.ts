/**
 * GET /config: what the app needs to know about the store before it shows
 * anything. The same for every shopper, so it is cached hard on the device.
 */
import * as z from "zod";

import { ImageSet } from "./common";
import { PasswordPolicy } from "./me";

export const Language = z.object({
  /** The locale as it appears in the path and in the store's settings. */
  code: z.string(),
  /** The language's name in English, and in the language itself. */
  name: z.string(),
  nativeName: z.string(),
  direction: z.enum(["ltr", "rtl"]),
});
export type Language = z.infer<typeof Language>;

/** The two colours a store sets for its brand, for one theme. */
export const BrandColors = z.object({
  primary: z.string(),
  primaryForeground: z.string(),
});
export type BrandColors = z.infer<typeof BrandColors>;

/** Versions of the app for one platform, set by the store's admin. */
export const AppRelease = z.object({
  /** Below this version the app must be updated before it can be used. */
  minVersion: z.string().optional(),
  latestVersion: z.string().optional(),
  storeUrl: z.string().optional(),
});
export type AppRelease = z.infer<typeof AppRelease>;

export const Config = z.object({
  store: z.object({
    name: z.string(),
    logo: ImageSet.optional(),
    /** The logo for a dark background, when the store uploaded one. */
    logoDark: ImageSet.optional(),
    /**
     * The store's square mark (its installed-app icon, else its favicon), for
     * a round avatar where the wide `logo` would not fit. Left out when the
     * store set neither: the app falls back to the name's first letter.
     */
    icon: ImageSet.optional(),
    /** The storefront on the web, for pages the app opens in a browser. */
    websiteUrl: z.string(),
  }),
  locale: z.object({
    /** The locale this response was written in (the one in the path). */
    current: z.string(),
    default: z.string(),
    languages: z.array(Language),
  }),
  /** A store sells in one currency. */
  currency: z.object({
    code: z.string(),
  }),
  theme: z.object({
    /** The theme the store opens in. */
    mode: z.enum(["light", "dark"]),
    brand: z.object({
      light: BrandColors,
      dark: BrandColors,
    }),
  }),
  features: z.object({
    multiVendor: z.boolean(),
    wishlist: z.boolean(),
    reviews: z.boolean(),
    guestCheckout: z.boolean(),
    /**
     * Products may be sold by quote ("Request a quote"): offer the shopper's
     * quotes (GET /me/quotes). A store that switches it off keeps the quotes
     * already sent; they stay reachable by their links.
     */
    quotes: z.boolean(),
    /**
     * Products may be sold as pre-orders: offer the shopper's pre-orders
     * (GET /orders with `preOrders`). Pre-orders already placed stay
     * reachable by their links when it is switched off.
     */
    preOrders: z.boolean(),
  }),
  app: z.object({
    ios: AppRelease,
    android: AppRelease,
  }),
  pages: z.object({
    privacyPolicyUrl: z.string().optional(),
    termsUrl: z.string().optional(),
    /**
     * The public page that says how to delete an account, from the app or
     * without it. Always there: app stores ask for it.
     */
    accountDeletionUrl: z.string(),
  }),
  auth: z.object({
    /**
     * The store's password rules, so sign-up and a password change can be
     * checked before anything is sent.
     */
    passwordPolicy: PasswordPolicy,
    /**
     * A new account must verify its email address before it can be used.
     * Sign-up still signs the shopper in, but every endpoint that needs them
     * answers 403 `EMAIL_NOT_VERIFIED` until the link in the email is opened
     * (endpoints a guest may use treat them as signed out meanwhile): after
     * sign-up, show "check your email" instead of the account.
     */
    emailVerificationRequired: z.boolean(),
    /**
     * Present while the store has "Continue with Google" on. The app signs
     * the shopper in with the phone's Google SDK, configured with
     * `webClientId` (the store's own Google OAuth client: public, it is in
     * every Google sign-in URL), and posts the ID token it gets to the auth
     * server: `POST /api/auth/sign-in/social` with
     * `{ provider: "google", idToken: { token } }`. The store accepts a token
     * only when its audience is this client. The answer is a session, as
     * after email sign-in. Absent: no Google button.
     */
    google: z
      .object({
        webClientId: z.string(),
      })
      .optional(),
  }),
});
export type Config = z.infer<typeof Config>;
