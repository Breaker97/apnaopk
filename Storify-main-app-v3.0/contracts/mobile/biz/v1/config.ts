/**
 * GET /config: what the business app needs to know about the store before it
 * signs anybody in. The same for everybody, so it is cached hard on the
 * device and on the server; it is the one endpoint that needs no session.
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

/** Versions of the business app for one platform, set by the store's admin. */
export const AppRelease = z.object({
  /** Below this version the app must be updated before it can change anything. */
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
     * a small square or round tile where the wide `logo` would not fit (the
     * store's workspace). Left out when the store set neither: the app falls
     * back to the logo.
     */
    icon: ImageSet.optional(),
    /** The storefront on the web. */
    websiteUrl: z.string(),
    /**
     * The website's sign-in page, for what the app leaves to the website
     * (a refund, a seller's subscription, store settings): open it in a
     * browser.
     */
    dashboardUrl: z.string(),
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
    /**
     * Sellers run their own shops on this store. Off: there is no vendor
     * workspace, and sellers' endpoints answer 404.
     */
    multiVendor: z.boolean(),
  }),
  /** The business app's versions (Settings → Mobile app → Business app). */
  app: z.object({
    ios: AppRelease,
    android: AppRelease,
  }),
  auth: z.object({
    /** The store's password rules, for the account screen's password change. */
    passwordPolicy: PasswordPolicy,
  }),
});
export type Config = z.infer<typeof Config>;
