import { isoDate, oneOf, str, color } from "@/lib/sliders/normalize-values";
import { readBoolean, readNumber } from "@/lib/site-config/normalize-primitives";
import { isInternalLink } from "@/lib/vendors/vendor-store-page";

/**
 * Campaign Banner: a popup or a bar the storefront Home page shows for a
 * while (Online Store → Campaign Banner). The platform owns some
 * (`vendorId` null), a vendor owns others and shows them on their own store
 * page only.
 *
 * Like the sliders, the contract lives HERE and is enforced twice: every
 * write passes through `normalizeCampaignBannerFields`, and so does every
 * read, so a stored or tampered document can never produce a value this file
 * does not describe. This module is client-safe on purpose — the editor, the
 * preview and the storefront host all read the same vocabulary.
 */

export const CAMPAIGN_BANNER_TYPES = ["popup", "bar"] as const;
export type CampaignBannerType = (typeof CAMPAIGN_BANNER_TYPES)[number];

/** What an editor chooses. `scheduled` and `ended` are derived, never stored. */
export const CAMPAIGN_BANNER_STATUSES = ["draft", "active", "paused"] as const;
export type CampaignBannerStatus = (typeof CAMPAIGN_BANNER_STATUSES)[number];

export type CampaignBannerState =
  | "draft"
  | "paused"
  | "scheduled"
  | "live"
  | "ended";

export const CAMPAIGN_BANNER_DEVICES = ["desktop", "mobile"] as const;
export type CampaignBannerDevice = (typeof CAMPAIGN_BANNER_DEVICES)[number];

export const CAMPAIGN_BANNER_TRIGGERS = ["immediate", "delay", "scroll"] as const;
export type CampaignBannerTriggerKind = (typeof CAMPAIGN_BANNER_TRIGGERS)[number];

export const CAMPAIGN_BANNER_FREQUENCIES = ["session", "days"] as const;
export type CampaignBannerFrequencyKind =
  (typeof CAMPAIGN_BANNER_FREQUENCIES)[number];

export const CAMPAIGN_BANNER_BAR_POSITIONS = ["top", "bottom"] as const;
export type CampaignBannerBarPosition =
  (typeof CAMPAIGN_BANNER_BAR_POSITIONS)[number];

/**
 * The editor's two Content tabs: `image` is "Only image content" (the popup is
 * just the picture), `content` is "Content with image" (the picture beside a
 * headline, text, button, offer or signup). Only a popup has the choice.
 */
export const CAMPAIGN_BANNER_CONTENT_MODES = ["image", "content"] as const;
export type CampaignBannerContentMode =
  (typeof CAMPAIGN_BANNER_CONTENT_MODES)[number];

/** A store keeps a handful of campaigns; the caps bound a runaway script. */
export const VENDOR_CAMPAIGN_BANNER_LIMIT = 30;
export const PLATFORM_CAMPAIGN_BANNER_LIMIT = 100;

export const MAX_TRIGGER_SECONDS = 120;
export const MAX_FREQUENCY_DAYS = 365;

/** The picture's size as a percentage of its own; 100 is as uploaded. */
export const CAMPAIGN_BANNER_IMAGE_SCALE = { min: 10, max: 300, default: 100 } as const;

export type CampaignBannerOwner = "platform" | "vendor";

export interface CampaignBannerSchedule {
  /** ISO instant (UTC). Absent means "from now". */
  start?: string;
  /** ISO instant (UTC). Absent means "until paused". */
  end?: string;
}

export interface CampaignBannerContent {
  /**
   * Which Content tab the popup is made on. In `image` mode the visitor sees
   * the picture and nothing else; whatever was typed on the other tab is kept
   * but not shown (see `campaignBannerAsShown`). A bar is always `content`.
   */
  mode: CampaignBannerContentMode;
  imageDesktop: string;
  imageMobile: string;
  imageAlt: string;
  /**
   * How big a picture-only popup draws its picture, as a percentage of the
   * picture's own size (100 = as uploaded). Never wider than the screen. With
   * a headline or a button the picture fills its half, so this is not read;
   * the "Only image content" tab is where it is set.
   */
  imageScale: number;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  /** Hex colours; empty means the storefront theme's own. */
  backgroundColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  /** Only read for a bar. */
  barPosition: CampaignBannerBarPosition;
}

export interface CampaignBannerCountdown {
  enabled: boolean;
  /** ISO instant; empty means the schedule's end. */
  endsAt: string;
}

export interface CampaignBannerSignup {
  enabled: boolean;
  placeholder: string;
  buttonLabel: string;
  consentText: string;
  successHeadline: string;
  successText: string;
}

export interface CampaignBannerRules {
  devices: CampaignBannerDevice[];
  trigger: { kind: CampaignBannerTriggerKind; seconds: number; percent: number };
  frequency: { kind: CampaignBannerFrequencyKind; days: number };
}

/** Everything an editor can set. */
export interface CampaignBannerFields {
  name: string;
  type: CampaignBannerType;
  status: CampaignBannerStatus;
  /** 0–100; the higher one wins when two of a kind both qualify. */
  priority: number;
  schedule: CampaignBannerSchedule;
  content: CampaignBannerContent;
  /** An existing coupon's code, or empty. */
  couponCode: string;
  countdown: CampaignBannerCountdown;
  signup: CampaignBannerSignup;
  rules: CampaignBannerRules;
}

/** A banner as the dashboard reads it. */
export interface CampaignBanner extends CampaignBannerFields {
  id: string;
  /** Null for the platform's own. */
  vendorId: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A banner as the storefront receives it: only what a visitor's browser
 * needs. No name, owner or status; a coupon code is present only when it can
 * be shown straight away (a banner with a signup form keeps its code back
 * until the visitor has signed up).
 */
export interface StorefrontCampaignBanner {
  id: string;
  type: CampaignBannerType;
  priority: number;
  updatedAt: string;
  schedule: CampaignBannerSchedule;
  content: CampaignBannerContent;
  couponCode: string;
  /** "10% off", for the line beside the code; empty when there is none. */
  couponOffer: string;
  /** True when a code waits behind the signup form. */
  couponAfterSignup: boolean;
  countdown: { enabled: boolean; endsAt: string };
  signup: CampaignBannerSignup;
  rules: CampaignBannerRules;
}

// ── Reading ──────────────────────────────────────────────────────────────

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The instant in canonical form, so equal moments compare equal as strings. */
function instant(value: unknown): string | undefined {
  const raw = isoDate(value);
  return raw ? new Date(Date.parse(raw)).toISOString() : undefined;
}

/**
 * A link a visitor may be sent to: a path on this site or an http(s) URL.
 * Anything else (`javascript:`, `data:`, protocol-relative) reads as no link.
 */
function href(value: unknown): string {
  const link = str(value, 600).trim();
  if (link === "") return "";
  if (/\s/.test(link) || link.includes("\\")) return "";
  if (link.startsWith("/") && !link.startsWith("//")) return link;
  return /^https?:\/\/[^/]/i.test(link) ? link : "";
}

/** A media URL: stored uploads and https links, never an inline script. */
function mediaUrl(value: unknown): string {
  const url = str(value, 1000).trim();
  if (url === "") return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return /^https?:\/\/[^/]/i.test(url) ? url : "";
}

/** A coupon code as the coupons store it: upper case, no spaces. */
export function normalizeCouponCode(value: unknown): string {
  return str(value, 30)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function normalizeSchedule(raw: unknown): CampaignBannerSchedule {
  const source = record(raw);
  const schedule: CampaignBannerSchedule = {};
  const start = instant(source.start);
  if (start) schedule.start = start;
  const end = instant(source.end);
  if (end) schedule.end = end;
  return schedule;
}

function normalizeContent(
  raw: unknown,
  owner: CampaignBannerOwner,
): Omit<CampaignBannerContent, "mode"> {
  const source = record(raw);
  const ctaHref = href(source.ctaHref);
  return {
    imageDesktop: mediaUrl(source.imageDesktop),
    imageMobile: mediaUrl(source.imageMobile),
    imageAlt: str(source.imageAlt, 200).trim(),
    imageScale: readNumber(
      source.imageScale,
      CAMPAIGN_BANNER_IMAGE_SCALE.default,
      CAMPAIGN_BANNER_IMAGE_SCALE.min,
      CAMPAIGN_BANNER_IMAGE_SCALE.max,
      0,
    ),
    headline: str(source.headline, 120).trim(),
    body: str(source.body, 400).trim(),
    ctaLabel: str(source.ctaLabel, 60).trim(),
    // A vendor's banner stays on this marketplace.
    ctaHref: owner === "vendor" && !isInternalLink(ctaHref) ? "" : ctaHref,
    backgroundColor: color(source.backgroundColor) ?? "",
    textColor: color(source.textColor) ?? "",
    buttonColor: color(source.buttonColor) ?? "",
    buttonTextColor: color(source.buttonTextColor) ?? "",
    barPosition: oneOf(
      source.barPosition,
      CAMPAIGN_BANNER_BAR_POSITIONS,
      "top",
    ),
  };
}

/**
 * The Content tab a banner is on. A banner saved before the tabs existed has
 * none stored: a picture with no words, offer or form already showed as a
 * picture-only popup, so it opens on the picture tab; anything else on the
 * other. A link without a button text counts as words, because the picture
 * used to be clickable through it and the picture tab has no link.
 */
function readContentMode(
  raw: unknown,
  type: CampaignBannerType,
  content: Omit<CampaignBannerContent, "mode">,
  rest: Pick<CampaignBannerFields, "couponCode" | "countdown" | "signup">,
): CampaignBannerContentMode {
  if (type !== "popup") return "content";
  const stored = record(raw).mode;
  if (stored === "image" || stored === "content") return stored;
  const hasImage = Boolean(content.imageDesktop || content.imageMobile);
  const hasCopy = Boolean(
    content.headline ||
      content.body ||
      content.ctaLabel ||
      content.ctaHref ||
      rest.couponCode ||
      rest.countdown.enabled ||
      rest.signup.enabled,
  );
  return hasImage && !hasCopy ? "image" : "content";
}

function normalizeCountdown(raw: unknown): CampaignBannerCountdown {
  const source = record(raw);
  return {
    enabled: readBoolean(source.enabled, false),
    endsAt: instant(source.endsAt) ?? "",
  };
}

function normalizeSignup(
  raw: unknown,
  owner: CampaignBannerOwner,
  type: CampaignBannerType,
): CampaignBannerSignup {
  const source = record(raw);
  return {
    // Consent is platform-wide, so only the platform's banners collect it;
    // and a form needs room, so only a popup does.
    enabled:
      owner === "platform" &&
      type === "popup" &&
      readBoolean(source.enabled, false),
    placeholder: str(source.placeholder, 80).trim(),
    buttonLabel: str(source.buttonLabel, 40).trim(),
    consentText: str(source.consentText, 200).trim(),
    successHeadline: str(source.successHeadline, 100).trim(),
    successText: str(source.successText, 200).trim(),
  };
}

function normalizeRules(raw: unknown): CampaignBannerRules {
  const source = record(raw);
  const trigger = record(source.trigger);
  const frequency = record(source.frequency);
  const picked: unknown[] = Array.isArray(source.devices) ? source.devices : [];
  const devices = CAMPAIGN_BANNER_DEVICES.filter((device) =>
    picked.includes(device),
  );
  return {
    // None picked reads as "both": a banner that shows to nobody is a bug.
    devices: devices.length > 0 ? devices : [...CAMPAIGN_BANNER_DEVICES],
    trigger: {
      kind: oneOf(trigger.kind, CAMPAIGN_BANNER_TRIGGERS, "delay"),
      seconds: readNumber(trigger.seconds, 5, 1, MAX_TRIGGER_SECONDS, 0),
      percent: readNumber(trigger.percent, 40, 5, 100, 0),
    },
    frequency: {
      kind: oneOf(frequency.kind, CAMPAIGN_BANNER_FREQUENCIES, "session"),
      days: readNumber(frequency.days, 7, 1, MAX_FREQUENCY_DAYS, 0),
    },
  };
}

/**
 * The one reader for the editable fields — a payload or a stored document.
 * `owner` carries the vendor rules: links stay on this marketplace and the
 * signup form is off.
 */
export function normalizeCampaignBannerFields(
  raw: unknown,
  owner: CampaignBannerOwner,
): CampaignBannerFields {
  const source = record(raw);
  const type = oneOf(source.type, CAMPAIGN_BANNER_TYPES, "popup");
  const content = normalizeContent(source.content, owner);
  const couponCode = normalizeCouponCode(source.couponCode);
  const countdown = normalizeCountdown(source.countdown);
  const signup = normalizeSignup(source.signup, owner, type);
  return {
    name: str(source.name, 100).trim(),
    type,
    status: oneOf(source.status, CAMPAIGN_BANNER_STATUSES, "draft"),
    priority: readNumber(source.priority, 50, 0, 100, 0),
    schedule: normalizeSchedule(source.schedule),
    content: {
      ...content,
      mode: readContentMode(source.content, type, content, {
        couponCode,
        countdown,
        signup,
      }),
    },
    couponCode,
    countdown,
    signup,
    rules: normalizeRules(source.rules),
  };
}

/** Whether a banner is a popup that shows its picture and nothing else. */
export function campaignBannerIsImageOnly(
  banner: Pick<CampaignBannerFields, "type" | "content">,
): boolean {
  return banner.type === "popup" && banner.content.mode === "image";
}

/**
 * The banner as a visitor gets it. On the "Only image content" tab the
 * headline, text, button, coupon, countdown and signup form are not part of
 * the popup, so they are blanked here and everything downstream (the shop,
 * the preview, the signup endpoint, the save check) works from a banner that
 * is simply a picture. They stay in the stored document, so switching back
 * to the other tab finds them where they were left.
 */
export function campaignBannerAsShown<
  T extends Pick<
    CampaignBannerFields,
    "type" | "content" | "couponCode" | "countdown" | "signup"
  >,
>(banner: T): T {
  if (!campaignBannerIsImageOnly(banner)) return banner;
  return {
    ...banner,
    couponCode: "",
    countdown: { ...banner.countdown, enabled: false },
    signup: { ...banner.signup, enabled: false },
    content: {
      ...banner.content,
      headline: "",
      body: "",
      ctaLabel: "",
      ctaHref: "",
    },
  };
}

function dateString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return isoDate(value);
}

/** A stored document as the dashboard reads it: ids as strings, fields normalized. */
export function toCampaignBanner(raw: unknown): CampaignBanner {
  const source = record(raw);
  const vendorId = source.vendorId ? String(source.vendorId) : null;
  return {
    ...normalizeCampaignBannerFields(source, vendorId ? "vendor" : "platform"),
    id: String(source._id ?? source.id ?? ""),
    vendorId,
    createdAt: dateString(source.createdAt),
    updatedAt: dateString(source.updatedAt),
  };
}

/** What a new banner starts as in the editor. */
export function defaultCampaignBannerFields(
  type: CampaignBannerType = "popup",
): CampaignBannerFields {
  const fields = normalizeCampaignBannerFields({ type }, "platform");
  return {
    ...fields,
    // The editor opens a popup on its first Content tab, the picture.
    content: { ...fields.content, mode: type === "popup" ? "image" : "content" },
    rules: {
      ...fields.rules,
      // A bar is always there; a popup waits for the visitor to settle in.
      trigger: {
        ...fields.rules.trigger,
        kind: type === "bar" ? "immediate" : "delay",
      },
    },
  };
}

// ── Time ─────────────────────────────────────────────────────────────────

/** Whether `now` falls inside the window. No bounds means always. */
export function scheduleIsLive(
  schedule: CampaignBannerSchedule,
  now: Date,
): boolean {
  const at = now.getTime();
  if (schedule.start && at < Date.parse(schedule.start)) return false;
  if (schedule.end && at >= Date.parse(schedule.end)) return false;
  return true;
}

/** Where a banner is in its life, at `now`. */
export function campaignBannerState(
  banner: Pick<CampaignBannerFields, "status" | "schedule">,
  now: Date,
): CampaignBannerState {
  if (banner.status === "draft") return "draft";
  if (banner.status === "paused") return "paused";
  const at = now.getTime();
  if (banner.schedule.start && at < Date.parse(banner.schedule.start)) {
    return "scheduled";
  }
  if (banner.schedule.end && at >= Date.parse(banner.schedule.end)) {
    return "ended";
  }
  return "live";
}

/** The countdown's target: its own date, else the campaign's end; empty when neither. */
export function campaignBannerCountdownEnd(
  banner: Pick<CampaignBannerFields, "countdown" | "schedule">,
): string {
  if (!banner.countdown.enabled) return "";
  return banner.countdown.endsAt || banner.schedule.end || "";
}

export type CampaignBannerProblemCode =
  | "name"
  | "endBeforeStart"
  | "needsContent"
  | "needsImage"
  | "ctaNeedsLink"
  | "countdownNeedsEnd"
  | "linkInvalid"
  | "linkVendor";

/**
 * The problems in English, for the API and the tests. The editor words them in
 * the viewer's language instead (admin.campaignBanners.form.problems.<code>).
 */
export const CAMPAIGN_BANNER_PROBLEMS: Record<CampaignBannerProblemCode, string> = {
  name: "A banner needs a name",
  endBeforeStart: "The end must be after the start",
  needsContent: "Add a headline, text or an image before turning a banner on",
  needsImage: "Add a picture before turning on a popup that is only an image",
  ctaNeedsLink: "A button needs a link",
  countdownNeedsEnd: "A countdown needs an end date",
  linkInvalid:
    "The button link must be a page on this site, starting with /, or a full https:// address",
  linkVendor: "The button link must point to a page on this store, starting with /",
};

/**
 * Why the button link in a PAYLOAD is refused, or null when it is fine or
 * empty. It reads the raw input on purpose: the normalizer blanks a bad link,
 * and a blank link reads as "no link" — which is how a vendor who typed an
 * outside address used to be told their button "needs a link".
 */
export function campaignBannerLinkProblem(
  rawContent: unknown,
  owner: CampaignBannerOwner,
): CampaignBannerProblemCode | null {
  const raw = record(rawContent).ctaHref;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const link = href(raw);
  if (link === "") return "linkInvalid";
  if (owner === "vendor" && !isInternalLink(link)) return "linkVendor";
  return null;
}

/** What stops a normalized banner being saved, or null. */
export function campaignBannerProblemCode(
  fields: CampaignBannerFields,
): CampaignBannerProblemCode | null {
  if (!fields.name) return "name";
  const { start, end } = fields.schedule;
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    return "endBeforeStart";
  }
  // What a visitor would get: text, a button or a countdown left over on the
  // other tab must not block a picture-only popup from being saved.
  const shown = campaignBannerAsShown(fields);
  const { content } = shown;
  const hasImage = Boolean(content.imageDesktop || content.imageMobile);
  if (fields.status === "active") {
    if (campaignBannerIsImageOnly(shown)) {
      if (!hasImage) return "needsImage";
    } else if (!content.headline && !content.body && !hasImage) {
      return "needsContent";
    }
  }
  if (content.ctaLabel && !content.ctaHref) return "ctaNeedsLink";
  if (shown.countdown.enabled && !campaignBannerCountdownEnd(shown)) {
    return "countdownNeedsEnd";
  }
  return null;
}

/** The same, as the English sentence. */
export function campaignBannerProblem(
  fields: CampaignBannerFields,
): string | null {
  const code = campaignBannerProblemCode(fields);
  return code ? CAMPAIGN_BANNER_PROBLEMS[code] : null;
}
