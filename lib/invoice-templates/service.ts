import "server-only";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { connectDB, mongoose } from "@/lib/db";
import { assertOwnStorageUrl } from "@/lib/storage/own-storage-url";
import { InvoiceTemplate as InvoiceTemplateModel } from "@/models/invoice-template.model";
import { templateNameKey } from "./draft-name";
import { ownerFilter, type TemplateOwner } from "./owner";
import { blankDesign, buildPresetDesign, isPresetKey, TEMPLATE_PRESETS } from "./presets";
import { isSameSitePath, parseTemplateDesign, type CreateTemplateInput, type UpdateTemplateInput } from "./schema";
import {
  SCHEMA_VERSION,
  TEMPLATE_LIMITS,
  type InvoiceTemplate,
  type TemplateCategory,
  type TemplateDesign,
  type TemplateLocale,
} from "./types";

/**
 * Invoice Template reads and writes for one owner (§4.3, §4.9). The platform's
 * templates and each vendor's share a collection, so the owner is applied to
 * EVERY query here, not by the callers — the Campaign Banner rule: another
 * owner's template is simply not found.
 *
 * Saves are compare-and-set on `version` (a stale save is a 409 the editor
 * answers with Reload / Overwrite); one default per owner and category is
 * held by a partial unique index; names are unique per owner and category,
 * whatever their case. Deleting the default returns that category to the
 * standard print (D-02).
 */

const TEMPLATE = "Invoice template";

type StoredTemplate = {
  _id: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId | null;
  category: TemplateCategory;
  name: string;
  isDefault?: boolean;
  presetKey?: string;
  locale?: TemplateLocale;
  canvas: TemplateDesign["canvas"];
  format: TemplateDesign["format"];
  elements?: TemplateDesign["elements"];
  version?: number;
  schemaVersion?: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

const iso = (value: Date | undefined) => (value ? new Date(value).toISOString() : undefined);

export function toInvoiceTemplate(doc: StoredTemplate): InvoiceTemplate {
  return {
    id: String(doc._id),
    vendorId: doc.vendorId ? String(doc.vendorId) : null,
    category: doc.category,
    name: doc.name,
    isDefault: Boolean(doc.isDefault),
    ...(doc.presetKey ? { presetKey: doc.presetKey } : {}),
    locale: doc.locale ?? "en",
    canvas: doc.canvas,
    format: doc.format,
    elements: doc.elements ?? [],
    version: doc.version ?? 1,
    schemaVersion: SCHEMA_VERSION,
    ...(doc.createdBy ? { createdBy: doc.createdBy } : {}),
    ...(doc.updatedBy ? { updatedBy: doc.updatedBy } : {}),
    ...(doc.createdAt ? { createdAt: iso(doc.createdAt) } : {}),
    ...(doc.updatedAt ? { updatedAt: iso(doc.updatedAt) } : {}),
  };
}

/** The name as uniqueness compares it (the model's `nameKey`); it lives in the client-safe draft-name.ts. */
export { templateNameKey };

function isDuplicateKey(error: unknown, field: "nameKey" | "isDefault"): boolean {
  const mongo = error as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  if (mongo?.code !== 11000) return false;
  if (mongo.keyPattern) {
    return field === "nameKey" ? "nameKey" in mongo.keyPattern : !("nameKey" in mongo.keyPattern);
  }
  return field === "nameKey" ? /nameKey/.test(mongo.message ?? "") : /one_default/.test(mongo.message ?? "");
}

const duplicateName = () =>
  new ValidationError({ name: ["A template with this name already exists — choose another name"] });

async function findOwned(owner: TemplateOwner, id: string): Promise<StoredTemplate> {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError(TEMPLATE);
  await connectDB();
  const doc = await InvoiceTemplateModel.findOne({ _id: id, ...ownerFilter(owner) }).lean<StoredTemplate>();
  if (!doc) throw new NotFoundError(TEMPLATE);
  return doc;
}

/** A design checked against the schema, with every image from the store's own storage (§4.14). */
async function checkedDesign(input: unknown): Promise<TemplateDesign> {
  const parsed = parseTemplateDesign(input);
  if (!parsed.ok) {
    throw new ValidationError({ [parsed.path ? `design.${parsed.path}` : "design"]: [parsed.error] });
  }
  for (const element of parsed.design.elements) {
    if (element.type !== "image" || element.config.source !== "media") continue;
    const src = element.config.src ?? "";
    // A same-site path is this store's own asset; anything else must be its
    // storage — including a "/…" the strict path rule refuses, such as
    // "/\evil.example/p.png", which a browser loads from another host.
    if (!src || isSameSitePath(src)) continue;
    try {
      await assertOwnStorageUrl(src);
    } catch {
      throw new ValidationError({
        [`design.elements.${element.id}`]: [`"${element.name}" must use an image from the media library`],
      });
    }
  }
  return parsed.design;
}

const noRoom = () =>
  new ValidationError(
    `You can keep up to ${TEMPLATE_LIMITS.templatesPerCategory} templates in this category — delete one to add another`,
  );

async function assertRoom(owner: TemplateOwner, category: TemplateCategory) {
  const count = await InvoiceTemplateModel.countDocuments({ ...ownerFilter(owner), category });
  if (count >= TEMPLATE_LIMITS.templatesPerCategory) throw noRoom();
}

/**
 * Insert a new template within the category's limit (D-18). `assertRoom`
 * before the insert answers the usual case; two creates racing at 49 both
 * pass it, so the count is taken again after the insert and an insert that
 * went over is taken back. Both racers may then be refused — never more than
 * the limit kept. No transaction, so a standalone MongoDB holds it too.
 */
async function insertWithinLimit(owner: TemplateOwner, category: TemplateCategory, data: Record<string, unknown>) {
  const doc = await InvoiceTemplateModel.create({ ...data, ...ownerFilter(owner), category });
  const count = await InvoiceTemplateModel.countDocuments({ ...ownerFilter(owner), category });
  if (count > TEMPLATE_LIMITS.templatesPerCategory) {
    await InvoiceTemplateModel.deleteOne({ _id: doc._id, ...ownerFilter(owner) });
    throw noRoom();
  }
  return toInvoiceTemplate(doc.toObject() as StoredTemplate);
}

async function nameTaken(owner: TemplateOwner, category: TemplateCategory, name: string, exceptId?: string) {
  return Boolean(
    await InvoiceTemplateModel.exists({
      ...ownerFilter(owner),
      category,
      nameKey: templateNameKey(name),
      ...(exceptId ? { _id: { $ne: new mongoose.Types.ObjectId(exceptId) } } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One owner's templates, the default first, then the latest edit. */
export async function listTemplates(
  owner: TemplateOwner,
  options: { category?: TemplateCategory } = {},
): Promise<InvoiceTemplate[]> {
  await connectDB();
  const docs = await InvoiceTemplateModel.find({
    ...ownerFilter(owner),
    ...(options.category ? { category: options.category } : {}),
  })
    .sort({ isDefault: -1, updatedAt: -1 })
    .limit(TEMPLATE_LIMITS.templatesPerCategory * 3)
    .lean<StoredTemplate[]>();
  return docs.map(toInvoiceTemplate);
}

export async function getTemplate(owner: TemplateOwner, id: string): Promise<InvoiceTemplate> {
  return toInvoiceTemplate(await findOwned(owner, id));
}

/**
 * The template a print uses (§4.8): the owner's default, then — for a vendor —
 * the platform's, then none. None means the caller prints the legacy output
 * unchanged (D-02). Read-only; never throws for "none".
 */
export async function resolveDefault(
  owner: TemplateOwner,
  category: TemplateCategory,
): Promise<InvoiceTemplate | null> {
  await connectDB();
  const owners: TemplateOwner[] = owner.kind === "vendor" ? [owner, { kind: "platform" }] : [owner];
  for (const candidate of owners) {
    const doc = await InvoiceTemplateModel.findOne({
      ...ownerFilter(candidate),
      category,
      isDefault: true,
    }).lean<StoredTemplate>();
    if (doc) return toInvoiceTemplate(doc);
  }
  return null;
}

/**
 * Which categories a print would use a template for, by the same chain as
 * `resolveDefault` (the owner's default, then the platform's for a vendor):
 * what the order pages ask before offering Print invoice or Print sticker.
 * One read, ids and categories only.
 */
export async function defaultCategories(owner: TemplateOwner): Promise<Record<TemplateCategory, boolean>> {
  await connectDB();
  const owners: TemplateOwner[] = owner.kind === "vendor" ? [owner, { kind: "platform" }] : [owner];
  const docs = await InvoiceTemplateModel.find({
    vendorId: { $in: owners.map((candidate) => ownerFilter(candidate).vendorId) },
    isDefault: true,
  })
    .select("category")
    .lean<Array<{ category: TemplateCategory }>>();
  const found = new Set(docs.map((doc) => doc.category));
  return { online: found.has("online"), pos: found.has("pos"), sticker: found.has("sticker") };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * A new template: a whole design ("Save as…" or the first save of an
 * unsaved draft), a preset in a language, or a blank canvas on the
 * category's default size.
 */
export async function createTemplate(
  owner: TemplateOwner,
  input: CreateTemplateInput,
  actorId: string,
): Promise<InvoiceTemplate> {
  const { category } = input;
  const name = input.name.trim();
  if (input.presetKey && (!isPresetKey(input.presetKey) || TEMPLATE_PRESETS[input.presetKey].category !== category)) {
    throw new ValidationError({ presetKey: ["That preset is not for this category"] });
  }
  // A draft opened from a preset is first saved as a whole design and keeps
  // its preset, so "Restore preset" works on it later.
  const presetKey = input.presetKey;
  let design: TemplateDesign;
  if (input.design) {
    design = await checkedDesign(input.design);
  } else if (input.presetKey && isPresetKey(input.presetKey)) {
    design = buildPresetDesign(input.presetKey, input.locale ?? "en");
  } else {
    design = blankDesign(category, input.locale ?? "en");
  }

  await connectDB();
  await assertRoom(owner, category);
  if (await nameTaken(owner, category, name)) throw duplicateName();

  try {
    return await insertWithinLimit(owner, category, {
      name,
      nameKey: templateNameKey(name),
      isDefault: false,
      ...(presetKey ? { presetKey } : {}),
      ...design,
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      createdBy: actorId,
      updatedBy: actorId,
    });
  } catch (error) {
    if (isDuplicateKey(error, "nameKey")) throw duplicateName();
    throw error;
  }
}

/**
 * Save a rename, a design, or both — only onto the version the caller edited.
 * A stale version is a 409 that names the current one, so the editor can
 * offer Reload or Overwrite (re-sending with that version).
 */
export async function updateTemplate(
  owner: TemplateOwner,
  id: string,
  input: UpdateTemplateInput,
  actorId: string,
): Promise<{ before: InvoiceTemplate; after: InvoiceTemplate }> {
  const stored = await findOwned(owner, id);
  const before = toInvoiceTemplate(stored);
  const set: Record<string, unknown> = { updatedBy: actorId };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (await nameTaken(owner, stored.category, name, id)) throw duplicateName();
    set.name = name;
    set.nameKey = templateNameKey(name);
  }
  if (input.design !== undefined) {
    const design = await checkedDesign(input.design);
    set.locale = design.locale;
    set.canvas = design.canvas;
    set.format = design.format;
    set.elements = design.elements;
  }

  let doc: StoredTemplate | null;
  try {
    doc = await InvoiceTemplateModel.findOneAndUpdate(
      { _id: stored._id, ...ownerFilter(owner), version: input.version },
      { $set: set, $inc: { version: 1 } },
      { returnDocument: "after" },
    ).lean<StoredTemplate>();
  } catch (error) {
    if (isDuplicateKey(error, "nameKey")) throw duplicateName();
    throw error;
  }
  if (!doc) await throwStaleOrGone(owner, id);
  return { before, after: toInvoiceTemplate(doc!) };
}

async function throwStaleOrGone(owner: TemplateOwner, id: string): Promise<never> {
  const current = await InvoiceTemplateModel.findOne({ _id: id, ...ownerFilter(owner) })
    .select("version updatedBy updatedAt")
    .lean<Pick<StoredTemplate, "version" | "updatedBy" | "updatedAt">>();
  if (!current) throw new NotFoundError(TEMPLATE);
  throw new ConflictError("This template was changed since you opened it", {
    reason: "stale_version",
    currentVersion: current.version ?? 1,
    ...(current.updatedAt ? { updatedAt: iso(current.updatedAt) } : {}),
  });
}

/** Delete a template. Deleting the default returns its category to the standard print. */
export async function deleteTemplate(owner: TemplateOwner, id: string): Promise<InvoiceTemplate> {
  const doc = await findOwned(owner, id);
  await InvoiceTemplateModel.deleteOne({ _id: doc._id, ...ownerFilter(owner) });
  return toInvoiceTemplate(doc);
}

/** "Name (copy)", then "Name (copy 2)" …, kept within the name limit. */
async function copyName(owner: TemplateOwner, category: TemplateCategory, name: string): Promise<string> {
  for (let attempt = 1; attempt <= TEMPLATE_LIMITS.templatesPerCategory + 1; attempt++) {
    const suffix = attempt === 1 ? " (copy)" : ` (copy ${attempt})`;
    const candidate = `${name.slice(0, TEMPLATE_LIMITS.nameLength - suffix.length).trimEnd()}${suffix}`;
    if (!(await nameTaken(owner, category, candidate))) return candidate;
  }
  throw duplicateName();
}

/** A copy of a template, never the default. */
export async function duplicateTemplate(
  owner: TemplateOwner,
  id: string,
  actorId: string,
): Promise<InvoiceTemplate> {
  const source = await findOwned(owner, id);
  await assertRoom(owner, source.category);
  const name = await copyName(owner, source.category, source.name);
  try {
    return await insertWithinLimit(owner, source.category, {
      name,
      nameKey: templateNameKey(name),
      isDefault: false,
      ...(source.presetKey ? { presetKey: source.presetKey } : {}),
      locale: source.locale ?? "en",
      canvas: source.canvas,
      format: source.format,
      elements: source.elements ?? [],
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      createdBy: actorId,
      updatedBy: actorId,
    });
  } catch (error) {
    if (isDuplicateKey(error, "nameKey")) throw duplicateName();
    throw error;
  }
}

/**
 * Make a template its category's default. The previous default is cleared
 * first; the partial unique index guarantees there is never more than one,
 * and a concurrent "set default" that loses the race is retried once.
 * Not a design change, so `version` is left alone.
 *
 * If the target can't be made the default after all (deleted in between, or
 * the write fails), the default this call cleared is put back, so a failed
 * request never leaves the category on the standard print. Two writes, no
 * transaction, so it works on a standalone MongoDB.
 */
export async function setDefaultTemplate(
  owner: TemplateOwner,
  id: string,
  actorId: string,
): Promise<{ template: InvoiceTemplate; replaced: InvoiceTemplate | null }> {
  const target = await findOwned(owner, id);
  const scope = { ...ownerFilter(owner), category: target.category };
  const previous = await InvoiceTemplateModel.findOne({ ...scope, isDefault: true }).lean<StoredTemplate>();
  if (previous && String(previous._id) === String(target._id)) {
    return { template: toInvoiceTemplate(previous), replaced: null };
  }
  for (let attempt = 0; ; attempt++) {
    // At most one default exists (the index), so this clears it and says which.
    const cleared = await InvoiceTemplateModel.findOneAndUpdate(
      { ...scope, isDefault: true, _id: { $ne: target._id } },
      { $set: { isDefault: false, updatedBy: actorId } },
      { returnDocument: "before" },
    ).lean<StoredTemplate>();
    try {
      const doc = await InvoiceTemplateModel.findOneAndUpdate(
        { _id: target._id, ...ownerFilter(owner) },
        { $set: { isDefault: true, updatedBy: actorId } },
        { returnDocument: "after" },
      ).lean<StoredTemplate>();
      if (!doc) throw new NotFoundError(TEMPLATE);
      return { template: toInvoiceTemplate(doc), replaced: previous ? toInvoiceTemplate(previous) : null };
    } catch (error) {
      if (attempt === 0 && isDuplicateKey(error, "isDefault")) continue;
      if (cleared) await restoreDefault(owner, cleared);
      if (isDuplicateKey(error, "isDefault")) {
        throw new ConflictError("Another default was set at the same moment — try again", { reason: "default_race" });
      }
      throw error;
    }
  }
}

/**
 * Put back a default `setDefaultTemplate` cleared. Best effort: if another
 * default took its place meanwhile (the index refuses a second), the category
 * has one, which is all this is for; and the caller's own error is the one
 * worth reporting.
 */
async function restoreDefault(owner: TemplateOwner, cleared: StoredTemplate) {
  try {
    await InvoiceTemplateModel.updateOne(
      { _id: cleared._id, ...ownerFilter(owner), isDefault: false },
      { $set: { isDefault: true, ...(cleared.updatedBy ? { updatedBy: cleared.updatedBy } : {}) } },
    );
  } catch {
    // See above.
  }
}

/** Stop using a template as the default: its category prints the standard output again. */
export async function removeDefaultTemplate(
  owner: TemplateOwner,
  id: string,
  actorId: string,
): Promise<InvoiceTemplate> {
  const target = await findOwned(owner, id);
  const doc = await InvoiceTemplateModel.findOneAndUpdate(
    { _id: target._id, ...ownerFilter(owner) },
    { $set: { isDefault: false, updatedBy: actorId } },
    { returnDocument: "after" },
  ).lean<StoredTemplate>();
  if (!doc) throw new NotFoundError(TEMPLATE);
  return toInvoiceTemplate(doc);
}

/**
 * Put a template back to the preset it was made from, in its own language.
 * The name and the default flag stay; the design is replaced and the version
 * moves on. With `version`, only onto that version (as a save).
 */
export async function restoreTemplatePreset(
  owner: TemplateOwner,
  id: string,
  actorId: string,
  options: { version?: number } = {},
): Promise<{ before: InvoiceTemplate; after: InvoiceTemplate }> {
  const stored = await findOwned(owner, id);
  if (!stored.presetKey || !isPresetKey(stored.presetKey)) {
    throw new ValidationError("This template was not made from a preset");
  }
  const design = buildPresetDesign(stored.presetKey, stored.locale ?? "en");
  const doc = await InvoiceTemplateModel.findOneAndUpdate(
    {
      _id: stored._id,
      ...ownerFilter(owner),
      ...(options.version !== undefined ? { version: options.version } : {}),
    },
    {
      $set: { canvas: design.canvas, format: design.format, elements: design.elements, updatedBy: actorId },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  ).lean<StoredTemplate>();
  if (!doc) await throwStaleOrGone(owner, id);
  return { before: toInvoiceTemplate(stored), after: toInvoiceTemplate(doc!) };
}
