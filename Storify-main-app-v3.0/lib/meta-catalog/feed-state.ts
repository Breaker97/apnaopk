import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";
import { connectDB } from "@/lib/db";
import {
  MetaCatalogFeed,
  type MetaCatalogSource,
} from "@/models/meta-catalog-feed.model";

/** 32 random bytes in base64url: exactly 43 characters, none of them a dot. */
export const META_FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type MetaCatalogSkipCounts = {
  preorder: number;
  noImage: number;
  noPrice: number;
};

export type MetaCatalogFeedState = {
  enabled: boolean;
  /**
   * How Meta gets the products while `enabled`: the feed URL, or the Catalog
   * API (lib/meta-catalog/live-state.ts). One at a time — a catalog fed by
   * both would have every item written by two sources.
   */
  source: MetaCatalogSource;
  token: string | null;
  tokenRotatedAt: Date | null;
  lastFetchedAt: Date | null;
  lastItemCount: number | null;
  lastSkipped: MetaCatalogSkipCounts | null;
};

type FeedRow = {
  enabled?: boolean;
  source?: MetaCatalogSource;
  token?: string;
  tokenRotatedAt?: Date;
  lastFetchedAt?: Date;
  lastItemCount?: number;
  lastSkipped?: Partial<MetaCatalogSkipCounts>;
};

const KEY = { key: "default" } as const;

function toState(row: FeedRow | null | undefined): MetaCatalogFeedState {
  return {
    enabled: row?.enabled === true,
    source: row?.source === "live" ? "live" : "feed",
    token: row?.token && META_FEED_TOKEN_PATTERN.test(row.token) ? row.token : null,
    tokenRotatedAt: row?.tokenRotatedAt ?? null,
    lastFetchedAt: row?.lastFetchedAt ?? null,
    lastItemCount:
      typeof row?.lastItemCount === "number" ? row.lastItemCount : null,
    lastSkipped: row?.lastSkipped
      ? {
          preorder: Number(row.lastSkipped.preorder) || 0,
          noImage: Number(row.lastSkipped.noImage) || 0,
          noPrice: Number(row.lastSkipped.noPrice) || 0,
        }
      : null,
  };
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function readMetaCatalogFeed(): Promise<MetaCatalogFeedState> {
  await connectDB();
  // The live sync's part of the row (its watcher's lists among it) is not
  // this reader's, and the feed and its pictures read this on every request.
  return toState(await MetaCatalogFeed.findOne(KEY).select("-live").lean<FeedRow>());
}

/**
 * Whether the scheduled feed is what Meta should be reading now. Its
 * pictures stay served in either source: the live sync sends the same
 * picture links.
 */
export function isMetaFeedServed(state: MetaCatalogFeedState): boolean {
  return state.enabled && state.source === "feed";
}

/**
 * Whether `given` is this feed's token. Compared as digests so the time taken
 * says nothing about how much of a guess was right, whatever its length.
 */
export function metaFeedTokenMatches(
  stored: string | null | undefined,
  given: string | null | undefined,
): boolean {
  if (!stored || !given) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(stored), digest(given));
}

/** The URL pasted into Commerce Manager. */
export function metaCatalogFeedUrl(token: string): string {
  return `${appBaseUrl()}/feeds/meta/${token}.xml`;
}

/**
 * Switch the feed on or off. The first switch-on mints the URL's token;
 * switching off keeps it, so turning the feed back on revives the same URL
 * Commerce Manager already holds.
 */
export async function setMetaCatalogFeedEnabled(
  enabled: boolean,
  userId: string,
): Promise<{ before: MetaCatalogFeedState; after: MetaCatalogFeedState }> {
  await connectDB();
  const before = toState(
    await MetaCatalogFeed.findOneAndUpdate(
      KEY,
      { $set: { enabled, updatedBy: userId }, $setOnInsert: KEY },
      { upsert: true, returnDocument: "before" },
    )
      .select("-live")
      .lean<FeedRow>(),
  );
  if (enabled && !before.token) {
    // Conditional, so two admins switching it on at once mint one token.
    await MetaCatalogFeed.updateOne(
      { ...KEY, $or: [{ token: { $exists: false } }, { token: null }, { token: "" }] },
      { $set: { token: newToken(), tokenRotatedAt: new Date() } },
    );
  }
  return { before, after: await readMetaCatalogFeed() };
}

/**
 * Choose how Meta gets the products. Nothing is sent or deleted here: the
 * feed URL stops (or starts) answering, and the live sync starts (or stops)
 * sending on its next run.
 */
export async function setMetaCatalogSource(
  source: MetaCatalogSource,
  userId: string,
): Promise<{ before: MetaCatalogFeedState; after: MetaCatalogFeedState }> {
  await connectDB();
  const before = toState(
    await MetaCatalogFeed.findOneAndUpdate(
      KEY,
      { $set: { source, updatedBy: userId }, $setOnInsert: { ...KEY, enabled: false } },
      { upsert: true, returnDocument: "before" },
    )
      .select("-live")
      .lean<FeedRow>(),
  );
  return { before, after: await readMetaCatalogFeed() };
}

/**
 * A new URL; the old one answers 404 from now on. What Meta saw at the old
 * URL is cleared with it, so the page reports the new one as not fetched yet
 * until Commerce Manager has been given it.
 */
export async function rotateMetaCatalogFeedToken(
  userId: string,
): Promise<MetaCatalogFeedState> {
  await connectDB();
  await MetaCatalogFeed.updateOne(
    KEY,
    {
      $set: { token: newToken(), tokenRotatedAt: new Date(), updatedBy: userId },
      $unset: { lastFetchedAt: "", lastItemCount: "", lastSkipped: "" },
      $setOnInsert: { ...KEY, enabled: false },
    },
    { upsert: true },
  );
  return readMetaCatalogFeed();
}

/**
 * What a complete fetch served. Written only while the token is still the one
 * that was fetched, so a fetch of the old URL that finishes after a rotation
 * does not report itself as the new URL's.
 */
export async function recordMetaCatalogFetch(
  token: string,
  stats: { itemCount: number; skipped: MetaCatalogSkipCounts },
): Promise<void> {
  await connectDB();
  await MetaCatalogFeed.updateOne(
    { ...KEY, token },
    {
      $set: {
        lastFetchedAt: new Date(),
        lastItemCount: stats.itemCount,
        lastSkipped: stats.skipped,
      },
    },
  );
}
