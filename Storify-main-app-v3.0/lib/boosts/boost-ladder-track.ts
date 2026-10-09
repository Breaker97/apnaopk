/**
 * The admin ladder's timeline, as plain data.
 *
 * Each rung draws one track: today on the left edge, `windowDays` wide, with
 * every booking drawn as ONE segment rather than a run of identical cells. A
 * run of same-coloured cells cannot say where one seller's booking ends and the
 * next begins, and that is the question the admin is usually asking ("who has
 * #1, and until when?").
 *
 * Pure, so the client ladder can import it and the rules can be tested without
 * rendering anything.
 */

import { addDays, daysBetweenInclusive } from "@/lib/boosts/boost-days";

/** One booked day on a rung, as the ladder page aggregates it. */
export type LadderDay = {
  /** UTC "YYYY-MM-DD". */
  day: string;
  store: string;
  product: string;
  campaignId: string;
  /** The booking behind the day is an unpaid checkout still holding it. */
  hold: boolean;
};

type LadderSegment = {
  campaignId: string;
  store: string;
  product: string;
  hold: boolean;
  /** The whole run, which may continue past the visible window. */
  firstDay: string;
  lastDay: string;
  days: number;
  /** Where the visible part starts, in days from the window's first day. */
  offset: number;
  /** How many of the run's days fall inside the window. */
  span: number;
};

export type LadderWindowSummary = {
  /** Days inside the window that are taken, holds included. */
  booked: number;
  /** Of `booked`, the days an unpaid checkout is holding. */
  held: number;
  /** First free day inside the window, as an offset; null when none is. */
  firstFree: number | null;
  /** Exclusive end of the free run that starts at `firstFree`. */
  freeRunEnd: number | null;
  /**
   * First free day anywhere in the booking horizon. A window that is sold out
   * still has an answer to "when can a vendor get this rung?" — reading it off
   * the visible window alone printed "fully booked" and hid the date.
   */
  nextFreeDay: string | null;
};

function sortedDays(days: LadderDay[]): LadderDay[] {
  return [...days].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Consecutive days held by the same booking, merged into one segment and
 * clipped to the window. Two back-to-back bookings stay two segments.
 */
export function buildLadderSegments(
  days: LadderDay[],
  today: string,
  windowDays: number,
): LadderSegment[] {
  const runs: LadderDay[][] = [];
  for (const entry of sortedDays(days)) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (
      run &&
      last &&
      last.campaignId === entry.campaignId &&
      addDays(last.day, 1) === entry.day
    ) {
      run.push(entry);
    } else {
      runs.push([entry]);
    }
  }

  const segments: LadderSegment[] = [];
  for (const run of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    const start = Math.max(0, daysBetweenInclusive(today, first.day) - 1);
    const end = Math.min(windowDays - 1, daysBetweenInclusive(today, last.day) - 1);
    if (end < 0 || start > windowDays - 1 || end < start) continue;
    segments.push({
      campaignId: first.campaignId,
      store: first.store,
      product: first.product,
      hold: first.hold,
      firstDay: first.day,
      lastDay: last.day,
      days: run.length,
      offset: start,
      span: end - start + 1,
    });
  }
  return segments;
}

/** What the window holds, and when the rung is next sellable. */
export function summarizeLadderWindow(
  days: LadderDay[],
  today: string,
  windowDays: number,
  horizonDays: number,
): LadderWindowSummary {
  const taken = new Map(days.map((entry) => [entry.day, entry]));

  let booked = 0;
  let held = 0;
  let firstFree: number | null = null;
  for (let offset = 0; offset < windowDays; offset += 1) {
    const entry = taken.get(addDays(today, offset));
    if (entry) {
      booked += 1;
      if (entry.hold) held += 1;
    } else if (firstFree === null) {
      firstFree = offset;
    }
  }

  let freeRunEnd: number | null = null;
  if (firstFree !== null) {
    freeRunEnd = firstFree;
    while (freeRunEnd < windowDays && !taken.has(addDays(today, freeRunEnd))) {
      freeRunEnd += 1;
    }
  }

  let nextFreeDay: string | null = null;
  const reach = Math.max(windowDays, horizonDays);
  for (let offset = 0; offset < reach; offset += 1) {
    const day = addDays(today, offset);
    if (!taken.has(day)) {
      nextFreeDay = day;
      break;
    }
  }

  return { booked, held, firstFree, freeRunEnd, nextFreeDay };
}

/**
 * Day offsets that get a date label on the shared axis. Daily for a week,
 * weekly for a month, fortnightly beyond. A tick in the last quarter or so is
 * dropped: the window's last day is labelled at the right edge, and on the
 * narrowest wide-layout track the two labels would run into each other.
 */
export function ladderAxisTicks(windowDays: number): number[] {
  const step =
    windowDays <= 7 ? 1 : windowDays <= 14 ? 2 : windowDays <= 31 ? 7 : 14;
  const ticks: number[] = [];
  for (let offset = 0; offset < windowDays; offset += step) {
    if (offset > 0 && offset / windowDays > 0.76) break;
    ticks.push(offset);
  }
  return ticks;
}

/** Divider spacing inside a track: every day up to a month, weekly beyond. */
export function ladderDividerStep(windowDays: number): number {
  return windowDays <= 31 ? 1 : 7;
}
