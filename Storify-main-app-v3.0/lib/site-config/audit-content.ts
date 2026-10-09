import { audit, type AuditContext } from "@/lib/audit";

/**
 * Audit rows for the storefront content an admin edits by hand: a slider, a
 * menu, a blog post, a blog category. One module, so they read the same in the
 * log.
 *
 * Two properties the callers rely on:
 *
 * 1. **Rows come from what moved, never from the request.** Each editor posts
 *    the whole form back on every save, so a save that changed one field arrives
 *    looking like a save of all of them. `auditContentUpdated` reads the stored
 *    document before and after, and writes a row only for fields that differ.
 * 2. **A row never carries the content itself.** A slider's slides, a menu's
 *    link tree and a post's body are long, and the log is not where they are
 *    kept. A field too big to quote is named in the row and left out of
 *    before/after; a short one (a name, a switch, a status) is quoted.
 *
 * `audit()` never throws, so none of these can fail the save that called it.
 */

type Doc = Record<string, unknown>;

/** What differs between one kind of content and the next. */
export interface ContentKind {
  resource: "slider" | "menu" | "blogPost" | "blogCategory";
  /** How a sentence names one of them. */
  noun: string;
  /** The fields a save can change, read off a stored document as the diff compares them. */
  snapshot: (doc: Doc) => Doc;
  /** Plain words for a field that reads badly as it is stored. */
  labels?: Record<string, string>;
  /** The on/off or lifecycle field. When it moves, the row is a STATUS_CHANGE. */
  statusField?: string;
}

const isRecord = (value: unknown): value is Doc =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A date as the instant it names, or nothing when there is none. */
function instant(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const SLIDER_CONTENT: ContentKind = {
  resource: "slider",
  noun: "slider",
  snapshot: (doc) => ({
    name: doc.name,
    handle: doc.handle,
    isActive: doc.isActive,
    transition: doc.transition,
    autoplaySeconds: doc.autoplaySeconds,
    controls: doc.controls,
    slides: doc.slides,
    // The stamp moves on every save; the work in the draft is what a save changes.
    draft: isRecord(doc.draft) ? { ...doc.draft, updatedAt: undefined } : undefined,
  }),
  labels: { isActive: "active", autoplaySeconds: "autoplay delay" },
  statusField: "isActive",
};

export const MENU_CONTENT: ContentKind = {
  resource: "menu",
  noun: "menu",
  snapshot: (doc) => ({
    name: doc.name,
    handle: doc.handle,
    location: doc.location,
    description: doc.description,
    isActive: doc.isActive,
    items: doc.items,
  }),
  labels: { isActive: "active", items: "links" },
  statusField: "isActive",
};

export const BLOG_POST_CONTENT: ContentKind = {
  resource: "blogPost",
  noun: "blog post",
  snapshot: (doc) => ({
    title: doc.title,
    slug: doc.slug,
    excerpt: doc.excerpt,
    content: doc.content,
    status: doc.status,
    visibility: doc.visibility,
    isFeatured: doc.isFeatured,
    allowComments: doc.allowComments,
    publishedAt: instant(doc.publishedAt),
    scheduledFor: instant(doc.scheduledFor),
    tags: doc.tags,
    categoryIds: doc.categoryIds,
    featuredImage: doc.featuredImage,
    seo: doc.seo,
  }),
  labels: {
    isFeatured: "featured",
    allowComments: "comments allowed",
    publishedAt: "publish date",
    scheduledFor: "scheduled date",
    categoryIds: "categories",
    featuredImage: "featured image",
    seo: "SEO",
  },
  statusField: "status",
};

export const BLOG_CATEGORY_CONTENT: ContentKind = {
  resource: "blogCategory",
  noun: "blog category",
  snapshot: (doc) => ({
    name: doc.name,
    slug: doc.slug,
    description: doc.description,
    image: doc.image,
    order: doc.order,
    isActive: doc.isActive,
  }),
  labels: { isActive: "active", order: "sort order" },
  statusField: "isActive",
};

/** The longest value a row quotes, and the longest one a sentence does. */
const QUOTED_LENGTH = 200;
const SAID_LENGTH = 40;

export const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Blank, null and absent are one thing: a form echoing an empty box back is not a change. */
const blanked = (_key: string, value: unknown) =>
  value === "" || value === null ? undefined : value;

function canonical(value: unknown): string {
  const text = JSON.stringify(value, blanked);
  return text === undefined || text === "{}" || text === "[]" ? "" : text;
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

function fits(value: unknown, length: number): boolean {
  return (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    (typeof value === "string" && value.length <= length)
  );
}

/** A value as the sentence says it. Text is quoted: a name can contain "to". */
function say(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return typeof value === "string" ? `"${value}"` : String(value);
}

const words = (field: string) =>
  field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

function pick(doc: Doc, fields: string[]): Doc | undefined {
  if (fields.length === 0) return undefined;
  return Object.fromEntries(fields.map((field) => [field, doc[field] ?? null]));
}

/** What moved between two snapshots of a document, and how a row may say so. */
export interface SnapshotDiff {
  /** Every field that differs. */
  fields: string[];
  /** The ones a row quotes: short, and not named-only. */
  quoted: string[];
  /** Listed when they move, never quoted: a receipt, a payee, a note. */
  named: readonly string[];
  was: Doc;
  now: Doc;
}

/**
 * The fields that differ between two snapshots, or null when none does (blank,
 * null and absent are one thing). `named` fields are reported as changed but
 * their values are kept out of the row and out of the sentence.
 */
export function diffSnapshots(
  was: Doc,
  now: Doc,
  named: readonly string[] = [],
): SnapshotDiff | null {
  const fields = Array.from(
    new Set([...Object.keys(was), ...Object.keys(now)]),
  ).filter((field) => !same(was[field], now[field]));
  if (fields.length === 0) return null;
  const quoted = fields.filter(
    (field) =>
      !named.includes(field) &&
      fits(was[field], QUOTED_LENGTH) &&
      fits(now[field], QUOTED_LENGTH),
  );
  return { fields, quoted, named, was, now };
}

/** The `changes` of an UPDATE row: only what moved, only what may be quoted. */
export function changesOf(diff: SnapshotDiff, summary: string) {
  return {
    before: pick(diff.was, diff.quoted),
    after: pick(diff.now, diff.quoted),
    fields: diff.fields,
    summary,
  };
}

/** One changed field for a sentence: `name ("a" to "b")`, or just its label when the values do not belong in one. */
export function sayChange(
  diff: SnapshotDiff,
  field: string,
  label: string = words(field),
): string {
  return !diff.named.includes(field) &&
    fits(diff.was[field], SAID_LENGTH) &&
    fits(diff.now[field], SAID_LENGTH)
    ? `${label} (${say(diff.was[field])} to ${say(diff.now[field])})`
    : label;
}

interface ContentSubject {
  id: string;
  name: string;
}

/** A new slider, menu or post. `detail` finishes the sentence: "with 3 slides". */
export function auditContentCreated(
  context: AuditContext,
  kind: ContentKind,
  subject: ContentSubject,
  after: Doc,
  detail?: string,
) {
  return audit(context, {
    action: "CREATE",
    resource: kind.resource,
    resourceId: subject.id,
    resourceName: subject.name,
    changes: {
      after,
      summary: `Created ${kind.noun} "${subject.name}"${detail ? ` ${detail}` : ""}`,
    },
  });
}

/**
 * A save. `before` and `after` are the stored document either side of the
 * write; nothing is written when no field differs between them.
 */
export async function auditContentUpdated(
  context: AuditContext,
  kind: ContentKind,
  subject: ContentSubject,
  before: object,
  after: object,
) {
  const diff = diffSnapshots(
    kind.snapshot(before as Doc),
    kind.snapshot(after as Doc),
  );
  if (!diff) return null;

  return audit(context, {
    action:
      kind.statusField && diff.fields.includes(kind.statusField)
        ? "STATUS_CHANGE"
        : "UPDATE",
    resource: kind.resource,
    resourceId: subject.id,
    resourceName: subject.name,
    changes: changesOf(
      diff,
      `Updated ${kind.noun} "${subject.name}": ${diff.fields
        .map((field) => sayChange(diff, field, kind.labels?.[field]))
        .join(", ")}`,
    ),
  });
}

/** A slider, menu or post that is gone. */
export function auditContentDeleted(
  context: AuditContext,
  kind: ContentKind,
  subject: ContentSubject,
  before: Doc,
) {
  return audit(context, {
    action: "DELETE",
    resource: kind.resource,
    resourceId: subject.id,
    resourceName: subject.name,
    changes: {
      before,
      summary: `Deleted ${kind.noun} "${subject.name}"`,
    },
  });
}
