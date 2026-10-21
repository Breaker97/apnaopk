/**
 * Saving the editor's document (docs/INVOICE_TEMPLATE_BUILDER.md §5.2, D-17):
 *
 * - **Save**, a draft: POST creates the template from the design as edited.
 * - **Save**, a saved template: PATCH `{ version, design, name? }` onto the
 *   version the editor holds. A 409 `stale_version` moves the machine to
 *   `conflict` with the server's `currentVersion`; **Overwrite** is a Save
 *   with `overwriteVersion` set to it.
 * - **Save as…**: POST a copy under a new name. The open template is not
 *   touched and stays as unsaved as it was.
 *
 * The state machine (save-machine.ts) lives in the store, so a second Save
 * while one is in flight is refused (`busy`) — no double submit. What was
 * sent becomes the saved baseline, so edits made while the request was out
 * stay "unsaved". The caller turns the outcome into toasts, dialogs and
 * navigation. The routes are the scope's (`SaveOptions.endpoint`): the
 * admin's by default, a vendor owner's own on the vendor's side.
 */
import type { StoreApi } from "zustand/vanilla";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { templateNameKey } from "@/lib/invoice-templates/draft-name";
import { canStartSave, type SaveKind } from "@/lib/invoice-templates/editor/save-machine";
import type { InvoiceTemplate, TemplateDesign } from "@/lib/invoice-templates/types";
import type { EditorState } from "./editor-store";

/** The admin's manage routes; a vendor's editor passes `/api/vendor/invoice-templates` as `endpoint`. */
export const TEMPLATES_API = "/api/admin/invoice-templates";

export type SaveRequest = { kind: "save"; overwriteVersion?: number } | { kind: "saveAs"; name: string };

export type SaveOutcome =
  /** A save is already in flight. */
  | { type: "busy" }
  /** Refused before sending: no name, or another template of the category has it. */
  | { type: "invalidName"; reason: "required" | "taken" }
  /** A draft's first save created the template. */
  | { type: "created"; template: InvoiceTemplate }
  | { type: "updated"; template: InvoiceTemplate }
  /** Save as… created a copy of `design` (the document as it was sent; the canvas may have moved on since). */
  | { type: "copied"; template: InvoiceTemplate; design: TemplateDesign }
  | { type: "conflict"; currentVersion: number }
  /** The server is a demo: nothing is saved. */
  | { type: "refused" }
  /** The server refused the name (taken since the page loaded). */
  | { type: "nameError"; message: string }
  | { type: "failed"; error: unknown };

export interface SaveTransport {
  post: <T>(url: string, body: unknown) => Promise<T>;
  patch: <T>(url: string, body: unknown) => Promise<T>;
}

export interface SaveOptions {
  transport?: SaveTransport;
  /** The manage routes to save through (the scope's); the admin's by default. */
  endpoint?: string;
  now?: () => number;
  /** Whether another template of this category already has the name (as `templateNameKey` compares). */
  isNameTaken?: (name: string) => boolean;
}

/** The other templates' names of a category, as a check for `SaveOptions.isNameTaken`. */
export function nameTakenCheck(names: readonly string[]): (name: string) => boolean {
  const taken = new Set(names.map(templateNameKey));
  return (name) => taken.has(templateNameKey(name));
}

/** For Save as…: the category's other names and the open template's own. */
export function copyNameTaken(isNameTaken: ((name: string) => boolean) | undefined, savedName: string): (name: string) => boolean {
  return (name) => templateNameKey(name) === templateNameKey(savedName) || Boolean(isNameTaken?.(name));
}

/** Why a name can't be used, or null. `own` is the name the template already has. */
export function nameProblem(name: string, isTaken: ((name: string) => boolean) | undefined, own?: string): "required" | "taken" | null {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (own !== undefined && templateNameKey(own) === templateNameKey(trimmed)) return null;
  return isTaken?.(trimmed) ? "taken" : null;
}

/** What was sent is now the saved document; a name typed with stray spaces takes the trimmed form it was saved as. */
function landed(store: StoreApi<EditorState>, design: EditorState["design"], name: string, template: InvoiceTemplate) {
  const state = store.getState();
  state.markSaved(design, name, { id: template.id, version: template.version });
  if (state.name !== name && state.name.trim() === name) state.setName(name);
}

const defaultTransport: SaveTransport = {
  post: (url, body) => apiClient.post(url, body),
  patch: (url, body) => apiClient.patch(url, body),
};

export async function saveEditorDocument(
  store: StoreApi<EditorState>,
  request: SaveRequest,
  options: SaveOptions = {},
): Promise<SaveOutcome> {
  const { transport = defaultTransport, now = Date.now, isNameTaken, endpoint = TEMPLATES_API } = options;
  const state = store.getState();
  if (!canStartSave(state.save)) return { type: "busy" };
  // Mid-drag, resize or rotate the canvas shows a preview, not the document (review E2, L9 follow-up).
  if (state.gestureBase) return { type: "busy" };

  const kind: SaveKind = request.kind;
  const design = state.design;
  const name = (request.kind === "saveAs" ? request.name : state.name).trim();
  const own = request.kind === "save" && !state.isDraft ? state.baseline.name : undefined;
  // A copy can't take the name of the template it is copied from either.
  const taken = request.kind === "saveAs" ? copyNameTaken(isNameTaken, state.baseline.name) : isNameTaken;
  const problem = nameProblem(name, taken, own);
  if (problem) return { type: "invalidName", reason: problem };

  state.dispatchSave({ type: "start", kind });
  try {
    const create = state.isDraft || request.kind === "saveAs";
    if (create) {
      const template = await transport.post<InvoiceTemplate>(endpoint, {
        category: state.category,
        name,
        locale: design.locale,
        ...(state.presetKey ? { presetKey: state.presetKey } : {}),
        design,
      });
      if (request.kind === "saveAs") {
        store.getState().dispatchSave({ type: "success", at: now() });
        return { type: "copied", template, design };
      }
      landed(store, design, name, template);
      store.getState().dispatchSave({ type: "success", at: now() });
      return { type: "created", template };
    }

    const version = request.kind === "save" && request.overwriteVersion !== undefined ? request.overwriteVersion : state.version;
    const renamed = name !== state.baseline.name;
    const template = await transport.patch<InvoiceTemplate>(`${endpoint}/${state.templateId}`, {
      version,
      design,
      ...(renamed ? { name } : {}),
    });
    landed(store, design, name, template);
    store.getState().dispatchSave({ type: "success", at: now() });
    return { type: "updated", template };
  } catch (error) {
    const latest = store.getState();
    if (error instanceof ApiClientError) {
      const currentVersion = error.details?.currentVersion;
      if (error.status === 409 && error.details?.reason === "stale_version" && typeof currentVersion === "number") {
        latest.dispatchSave({ type: "conflict", currentVersion });
        return { type: "conflict", currentVersion };
      }
      if (error.code === "DEMO_MODE_READ_ONLY") {
        latest.dispatchSave({ type: "failure", error: error.message });
        return { type: "refused" };
      }
      const nameError = error.errors?.name?.[0];
      if (nameError) {
        latest.dispatchSave({ type: "failure", error: nameError });
        return { type: "nameError", message: nameError };
      }
    }
    latest.dispatchSave({ type: "failure", error: error instanceof Error ? error.message : String(error) });
    return { type: "failed", error };
  }
}
