import type { StudioSession, StudioTab } from "./studio/types";

// ── Draft autosave ──────────────────────────────────────────────────────────
// The studio holds unsaved work (a written prompt, generated/edited versions)
// only in React state, so a page reload would lose it. The studio mirrors a
// small, serializable slice to localStorage while open and restores it on the
// next open — so a reload never throws away the vendor's work. Kept at module
// scope so `Date.now()` isn't called during render (component purity rule).

export const AI_STUDIO_DRAFT_STORAGE_PREFIX = "storify.ai-studio.draft.";

const AI_STUDIO_DRAFT_VERSION = 1;
/** Drop drafts older than a day so abandoned work doesn't linger forever. */
export const AI_STUDIO_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type StudioDraft = {
  v: number;
  savedAt: number;
  sessions: Record<string, StudioSession>;
  selectedKey: string | null;
  prompt: string;
  activeTab: StudioTab;
  quickCategory: string;
};

export function loadStudioDraft(key: string | undefined): StudioDraft | null {
  if (!key || typeof window === "undefined") return null;
  const storageKey = AI_STUDIO_DRAFT_STORAGE_PREFIX + key;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const draft = JSON.parse(raw) as StudioDraft;
    const valid =
      draft &&
      draft.v === AI_STUDIO_DRAFT_VERSION &&
      typeof draft.savedAt === "number" &&
      Date.now() - draft.savedAt <= AI_STUDIO_DRAFT_TTL_MS &&
      draft.sessions &&
      typeof draft.sessions === "object";
    if (!valid) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveStudioDraft(
  key: string | undefined,
  data: Omit<StudioDraft, "v" | "savedAt">,
) {
  if (!key || typeof window === "undefined") return;
  try {
    const draft: StudioDraft = {
      v: AI_STUDIO_DRAFT_VERSION,
      savedAt: Date.now(),
      ...data,
    };
    window.localStorage.setItem(
      AI_STUDIO_DRAFT_STORAGE_PREFIX + key,
      JSON.stringify(draft),
    );
  } catch {
    // Quota or serialization failure — a lost autosave must never break editing.
  }
}

export function clearStudioDraft(key: string | undefined) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AI_STUDIO_DRAFT_STORAGE_PREFIX + key);
  } catch {
    // ignore
  }
}

export function clearAiStudioDraftsByPersistKeyPrefix(
  persistKeyPrefix: string,
): void {
  if (!persistKeyPrefix || typeof window === "undefined") return;
  const storagePrefix = AI_STUDIO_DRAFT_STORAGE_PREFIX + persistKeyPrefix;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(storagePrefix)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage access can be blocked; draft cleanup must not block slide removal.
  }
}
