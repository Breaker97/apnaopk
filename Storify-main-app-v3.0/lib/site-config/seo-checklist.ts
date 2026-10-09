/**
 * Deterministic SEO health checks for the Search Engine Listing card. Pure
 * rules — no AI — so the score is instant, free, and identical everywhere.
 * The AI "Improve SEO" action is the fix; this is the diagnosis.
 */

type SeoCheckStatus = "pass" | "warn" | "fail";

export type SeoCheckItem = {
  key:
    | "title"
    | "metaDescription"
    | "handle"
    | "content"
    | "tags";
  status: SeoCheckStatus;
  /** Which built-in message applies; the UI maps it to a localized string. */
  message:
    | "titleMissing"
    | "titleShort"
    | "titleLong"
    | "titleGood"
    | "metaMissing"
    | "metaAuto"
    | "metaShort"
    | "metaLong"
    | "metaGood"
    | "handleMissing"
    | "handleAuto"
    | "handleMessy"
    | "handleGood"
    | "contentThin"
    | "contentGood"
    | "tagsMissing"
    | "tagsGood";
};

export type SeoChecklistInput = {
  /** Explicit SEO page title (may be empty — falls back to entity title). */
  pageTitle: string;
  /** Explicit meta description (may be empty — falls back to body content). */
  metaDescription: string;
  /** Explicit handle/slug (may be empty — auto-generated from title). */
  handle: string;
  /** Entity title (product name, post title, …). */
  title: string;
  /** Entity body content — HTML allowed; tags are stripped before measuring. */
  description: string;
  tags?: string[];
  titleMaxChars?: number;
  descriptionMaxChars?: number;
};

type SeoChecklistResult = {
  items: SeoCheckItem[];
  /** 0–100. pass = full credit, warn = half, fail = none. */
  score: number;
  status: SeoCheckStatus;
};

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CLEAN_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function evaluateSeoChecklist(
  input: SeoChecklistInput,
): SeoChecklistResult {
  const titleMax = input.titleMaxChars ?? 70;
  const descriptionMax = input.descriptionMaxChars ?? 160;
  const items: SeoCheckItem[] = [];

  // Title — what search engines will show as the headline.
  const effectiveTitle = (input.pageTitle || input.title).trim();
  if (!effectiveTitle) {
    items.push({ key: "title", status: "fail", message: "titleMissing" });
  } else if (effectiveTitle.length > titleMax) {
    items.push({ key: "title", status: "fail", message: "titleLong" });
  } else if (effectiveTitle.length < 30) {
    items.push({ key: "title", status: "warn", message: "titleShort" });
  } else {
    items.push({ key: "title", status: "pass", message: "titleGood" });
  }

  // Meta description — explicit beats derived; derived-only is a warning.
  const explicitMeta = input.metaDescription.trim();
  const derivedMeta = stripHtml(input.description);
  if (explicitMeta) {
    if (explicitMeta.length > descriptionMax) {
      items.push({
        key: "metaDescription",
        status: "fail",
        message: "metaLong",
      });
    } else if (explicitMeta.length < 70) {
      items.push({
        key: "metaDescription",
        status: "warn",
        message: "metaShort",
      });
    } else {
      items.push({
        key: "metaDescription",
        status: "pass",
        message: "metaGood",
      });
    }
  } else if (derivedMeta) {
    items.push({ key: "metaDescription", status: "warn", message: "metaAuto" });
  } else {
    items.push({
      key: "metaDescription",
      status: "fail",
      message: "metaMissing",
    });
  }

  // Handle — explicit and clean beats auto-generated.
  const handle = input.handle.trim();
  if (handle) {
    if (CLEAN_HANDLE.test(handle) && handle.length >= 3 && handle.length <= 100) {
      items.push({ key: "handle", status: "pass", message: "handleGood" });
    } else {
      items.push({ key: "handle", status: "warn", message: "handleMessy" });
    }
  } else if (input.title.trim()) {
    items.push({ key: "handle", status: "warn", message: "handleAuto" });
  } else {
    items.push({ key: "handle", status: "fail", message: "handleMissing" });
  }

  // Body content depth — thin content ranks poorly.
  if (derivedMeta.length >= 300) {
    items.push({ key: "content", status: "pass", message: "contentGood" });
  } else {
    items.push({ key: "content", status: "warn", message: "contentThin" });
  }

  // Tags — optional signal, never a failure.
  if (input.tags && input.tags.length > 0) {
    items.push({ key: "tags", status: "pass", message: "tagsGood" });
  } else if (input.tags) {
    items.push({ key: "tags", status: "warn", message: "tagsMissing" });
  }

  const credit = items.reduce(
    (sum, item) =>
      sum + (item.status === "pass" ? 1 : item.status === "warn" ? 0.5 : 0),
    0,
  );
  const score = items.length
    ? Math.round((credit / items.length) * 100)
    : 0;
  const status: SeoCheckStatus = items.some((item) => item.status === "fail")
    ? "fail"
    : items.some((item) => item.status === "warn")
      ? "warn"
      : "pass";

  return { items, score, status };
}
