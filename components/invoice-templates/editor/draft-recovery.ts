/**
 * The local draft-recovery copy (D-17, docs §5.2): while a template has
 * unsaved changes, the editor keeps a copy of the document in this browser's
 * `localStorage`, and offers it back when the editor next opens that
 * template (or that new draft) after the page was left without saving: a
 * crash, a closed tab, the browser's Back.
 *
 * One copy per template (`…:<id>`) or per kind of new draft
 * (`…:new:<category>:<preset or blank>`, `…:vendor:<store id>:new:…` for a
 * vendor store's). Storage can be missing, full or
 * blocked (private windows): every access is wrapped, and the editor works
 * the same without it.
 */
import { parseTemplateDesign } from "@/lib/invoice-templates/schema";
import type { TemplateCategory, TemplateDesign } from "@/lib/invoice-templates/types";

export const RECOVERY_PREFIX = "storify:invoice-template-draft:";

export interface RecoveryCopy {
  v: 1;
  /** When it was written (ms). */
  savedAt: number;
  name: string;
  /** The saved name the edits started from: the name is restored only when it was changed. */
  baseName?: string;
  design: TemplateDesign;
  /** The stored version the edits started from; null for a draft. */
  baseVersion: number | null;
  /**
   * Edits carried over from the editor that created this template (made while
   * its first Save or Save as… was out): put back by themselves when the new
   * template opens on `baseVersion`, instead of being offered.
   */
  carried?: true;
}

/** Whose editor it is: the admin's (the platform's templates), or a vendor store's, by the store's id. */
export type RecoveryOwner = "admin" | { storeId: string };

/**
 * A saved template's id is unique across owners; a new draft's key carries
 * the owner on the vendor's side (`…:vendor:<store id>:new:…`), so an
 * unsaved draft is never offered to another store's vendor on the same
 * browser, nor to the admin, or the other way round. The admin's keys are as
 * they always were.
 */
export function recoveryKey(
  input: { templateId: string | null; category: TemplateCategory; presetKey: string | null },
  owner: RecoveryOwner = "admin",
): string {
  if (input.templateId) return `${RECOVERY_PREFIX}${input.templateId}`;
  const scope = owner === "admin" ? "" : `vendor:${owner.storeId}:`;
  return `${RECOVERY_PREFIX}${scope}new:${input.category}:${input.presetKey ?? "blank"}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The copy under `key`, if there is one and it is still a valid design. */
export function readRecovery(key: string): RecoveryCopy | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RecoveryCopy>;
    if (value?.v !== 1 || typeof value.name !== "string" || typeof value.savedAt !== "number") return null;
    const parsed = parseTemplateDesign(value.design);
    if (!parsed.ok) return null;
    return {
      v: 1,
      savedAt: value.savedAt,
      name: value.name,
      ...(typeof value.baseName === "string" ? { baseName: value.baseName } : {}),
      design: parsed.design,
      baseVersion: typeof value.baseVersion === "number" ? value.baseVersion : null,
      ...(value.carried === true ? { carried: true as const } : {}),
    };
  } catch {
    return null;
  }
}

/** Writes the copy; false when the browser wouldn't keep it. */
export function writeRecovery(key: string, copy: Omit<RecoveryCopy, "v">): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(key, JSON.stringify({ v: 1, ...copy }));
    return true;
  } catch {
    return false;
  }
}

/** The name a restore should leave: the copy's, if it was a rename; otherwise the one open now. */
export function recoveredName(copy: Pick<RecoveryCopy, "name" | "baseName">, current: string): string {
  return copy.baseName !== undefined && copy.name === copy.baseName ? current : copy.name;
}

export function clearRecovery(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to clear without storage.
  }
}
