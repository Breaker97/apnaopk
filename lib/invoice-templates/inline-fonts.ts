/**
 * The template faces as `data:` URLs, for a print that must not need the
 * network (the till's receipt, online or offline).
 *
 * The print iframe is written with `document.write`, so it is not under the
 * service worker: offline, it can't reach the font files the worker cached,
 * and the template couldn't print (found by the Phase 6 browser run). The
 * page itself is under the worker, so it reads the files once — through the
 * worker's cache when offline — and the receipt carries them in its own
 * `@font-face` rules (`fontFaceCss(origin, inline)`).
 *
 * Read once per page and kept in memory (about 0.6 MB); a failure is not
 * remembered, so the next print tries again. Client only; GET requests only.
 *
 * A stalled network must not hold a receipt (or the legacy one it falls back
 * to): the read is aborted at the time limit of the call that started it, and
 * a call with its own `timeoutMs` answers null once that has passed, even
 * while an earlier, longer read is still going.
 */
import { FONT_FILE_PATH, fontFaceCss, TEMPLATE_FONT_FACES } from "./fonts";

/** How long a read may take when the caller sets no limit. */
const DEFAULT_TIMEOUT_MS = 15_000;

let pending: Promise<string | null> | null = null;

async function dataUrl(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return `data:font/woff2;base64,${btoa(binary)}`;
}

function read(base: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const attempt = Promise.all(
    TEMPLATE_FONT_FACES.map(
      async (face) => [face.file, await dataUrl(`${base}${FONT_FILE_PATH}${face.file}`, controller.signal)] as const,
    ),
  )
    .then((entries) => fontFaceCss(base, Object.fromEntries(entries)))
    .catch(() => {
      if (pending === attempt) pending = null;
      return null;
    })
    .finally(() => clearTimeout(timer));
  return attempt;
}

function within(attempt: Promise<string | null>, timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([attempt, late]).finally(() => clearTimeout(timer));
}

/**
 * The `@font-face` rules with every face inline, or null when a file can't be
 * read within `timeoutMs` (default 15 s).
 */
export function inlineTemplateFontFaces(origin?: string, options: { timeoutMs?: number } = {}): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (pending) return within(pending, timeoutMs);
  const base = (origin ?? window.location.origin).replace(/\/$/, "");
  pending = read(base, timeoutMs);
  return pending;
}

/** Forgets what was read (tests). */
export function forgetInlineTemplateFontFaces(): void {
  pending = null;
}
