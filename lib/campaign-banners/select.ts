import {
  scheduleIsLive,
  type CampaignBannerDevice,
  type StorefrontCampaignBanner,
} from "./types";

/**
 * Which banners a visitor gets. Pure on purpose: the server cannot decide
 * this (the Home page is a cached render shared by everyone), so the browser
 * runs it against what it remembers — and a test can run it against anything.
 */

/** What the browser remembers about one visitor. */
export interface VisitorMemory {
  /** Banner id → when the visitor closed it (epoch ms). Survives sessions. */
  closed: Record<string, number>;
  /** Banners whose signup the visitor finished. Survives sessions. */
  converted: Record<string, true>;
  /** Closed in this tab session. */
  sessionClosed: readonly string[];
  /** Shown in this tab session. */
  sessionShown: readonly string[];
}

export const EMPTY_VISITOR_MEMORY: VisitorMemory = {
  closed: {},
  converted: {},
  sessionClosed: [],
  sessionShown: [],
};

type Selectable = Pick<
  StorefrontCampaignBanner,
  "id" | "type" | "priority" | "updatedAt" | "schedule" | "rules"
>;

export interface CampaignBannerContext {
  now: Date;
  device: CampaignBannerDevice;
  memory: VisitorMemory;
}

const DAY_MS = 86_400_000;

/**
 * Whether this visitor should see the banner right now.
 *
 * - "once per session": a popup is shown once per tab session; a bar stays on
 *   every page load until the visitor closes it that session — a bar that
 *   vanished on the next navigation would look like a bug.
 * - "again after N days": closing it starts a quiet period of N days. A popup
 *   is also shown at most once per session, so a visitor who never closed it
 *   is not met by it on every visit to Home.
 */
export function campaignBannerIsEligible(
  banner: Selectable,
  { now, device, memory }: CampaignBannerContext,
): boolean {
  if (!scheduleIsLive(banner.schedule, now)) return false;
  if (!banner.rules.devices.includes(device)) return false;
  if (memory.converted[banner.id]) return false;

  const { frequency } = banner.rules;
  if (frequency.kind === "days") {
    const closedAt = memory.closed[banner.id];
    if (
      closedAt !== undefined &&
      now.getTime() - closedAt < frequency.days * DAY_MS
    ) {
      return false;
    }
    return banner.type === "bar" || !memory.sessionShown.includes(banner.id);
  }
  return banner.type === "bar"
    ? !memory.sessionClosed.includes(banner.id)
    : !memory.sessionShown.includes(banner.id);
}

/** Highest priority first; ties go to the one edited last, then by id. */
function byPriority(a: Selectable, b: Selectable): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

/**
 * At most one popup and one bar — a popup and a bar may share a page, two
 * popups may not.
 */
export function pickCampaignBanners<T extends Selectable>(
  banners: readonly T[],
  context: CampaignBannerContext,
): { popup: T | null; bar: T | null } {
  const eligible = banners
    .filter((banner) => campaignBannerIsEligible(banner, context))
    .sort(byPriority);
  return {
    popup: eligible.find((banner) => banner.type === "popup") ?? null,
    bar: eligible.find((banner) => banner.type === "bar") ?? null,
  };
}
