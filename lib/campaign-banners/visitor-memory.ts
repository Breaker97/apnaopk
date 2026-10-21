import { EMPTY_VISITOR_MEMORY, type VisitorMemory } from "./select";

/**
 * The browser side of "who has seen what". Two stores, because the rules
 * need two lifetimes: localStorage for what outlives a visit (closed
 * recently, already signed up), sessionStorage for what lasts one tab session
 * (shown, closed). Every access is wrapped — storage can be missing, blocked
 * or full (a private window, a browser setting), and a banner must still
 * render without it; the cost is that this visitor is shown it more often.
 */

const LOCAL_KEY = "storify:campaign-banners:v1";
const SESSION_KEY = "storify:campaign-banners:session:v1";

/** Remembered state older than this is dropped on the next write. */
const FORGET_AFTER_MS = 400 * 86_400_000;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson(kind: "local" | "session", key: string): Record<string, unknown> {
  try {
    const raw = storage(kind)?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeJson(kind: "local" | "session", key: string, value: unknown) {
  try {
    storage(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked: the visitor simply sees the banner again.
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function persisted(): Pick<VisitorMemory, "closed" | "converted"> {
  const stored = readJson("local", LOCAL_KEY);
  const closed: Record<string, number> = {};
  const rawClosed =
    typeof stored.closed === "object" && stored.closed !== null
      ? (stored.closed as Record<string, unknown>)
      : {};
  for (const [id, at] of Object.entries(rawClosed)) {
    if (typeof at === "number" && Number.isFinite(at)) closed[id] = at;
  }
  const converted: Record<string, true> = {};
  const rawConverted =
    typeof stored.converted === "object" && stored.converted !== null
      ? (stored.converted as Record<string, unknown>)
      : {};
  for (const id of Object.keys(rawConverted)) {
    if (rawConverted[id]) converted[id] = true;
  }
  return { closed, converted };
}

function session(): Pick<VisitorMemory, "sessionClosed" | "sessionShown"> {
  const stored = readJson("session", SESSION_KEY);
  return {
    sessionClosed: stringList(stored.closed),
    sessionShown: stringList(stored.shown),
  };
}

export function readVisitorMemory(): VisitorMemory {
  if (typeof window === "undefined") return EMPTY_VISITOR_MEMORY;
  return { ...persisted(), ...session() };
}

function remember(id: string, kind: "shown" | "closed") {
  const stored = session();
  const shown = new Set(stored.sessionShown);
  const closed = new Set(stored.sessionClosed);
  (kind === "shown" ? shown : closed).add(id);
  writeJson("session", SESSION_KEY, {
    shown: [...shown],
    closed: [...closed],
  });
}

/** The banner reached the visitor's screen. */
export function markCampaignBannerShown(id: string) {
  remember(id, "shown");
}

/** The visitor dismissed it (or followed its button). */
export function markCampaignBannerClosed(id: string, now = Date.now()) {
  remember(id, "closed");
  const current = persisted();
  const closed: Record<string, number> = {};
  for (const [key, at] of Object.entries({ ...current.closed, [id]: now })) {
    if (now - at < FORGET_AFTER_MS) closed[key] = at;
  }
  writeJson("local", LOCAL_KEY, { ...current, closed });
}

/** The visitor signed up; the banner has done its job for good. */
export function markCampaignBannerConverted(id: string) {
  remember(id, "closed");
  const current = persisted();
  writeJson("local", LOCAL_KEY, {
    ...current,
    converted: { ...current.converted, [id]: true },
  });
}
