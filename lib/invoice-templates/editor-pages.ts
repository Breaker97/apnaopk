import "server-only";

import { getTranslations } from "next-intl/server";
import type { TemplateEditorSource } from "@/components/invoice-templates/editor/template-editor-screen";
import type { PreviewSource } from "@/components/invoice-templates/preview/template-preview-screen";
import { NotFoundError } from "@/lib/api/errors";
import { freeTemplateName } from "./draft-name";
import type { TemplateOwner } from "./owner";
import { blankDesign, buildPresetDesign, isPresetKey, presetName, TEMPLATE_PRESETS } from "./presets";
import { getTemplate, listTemplates, templateNameKey } from "./service";
import { TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateLocale } from "./types";

/**
 * What the editor's and the preview's pages read from their query, for one
 * owner — the admin's pages with the platform's, a vendor owner's with their
 * store's (Phase 7). The pages only add their own guard and scope.
 */

type Search = { [key: string]: string | string[] | undefined };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const MAX_SAMPLE_ITEMS = 200;

/** The preset text's language: `?lang=` en | bn, else the dashboard's language when it is bn, else en (D-14). */
function draftLanguage(search: Search, locale: string): TemplateLocale {
  const lang = one(search.lang);
  return lang === "bn" || lang === "en" ? lang : locale === "bn" ? "bn" : "en";
}

/**
 * A new template as an unsaved draft (docs §4.10): `?category=` online | pos |
 * sticker, `?preset=` a built-in preset of that category (otherwise a blank
 * canvas on the category's default size), `?lang=` en | bn for the preset's
 * text. Null for a missing or unknown category (the page's 404). Nothing is
 * created until the draft's first Save; the suggested name is the first one
 * the owner's category doesn't have.
 */
export async function draftEditorSource(
  owner: TemplateOwner,
  { locale, search }: { locale: string; search: Search },
): Promise<{ source: TemplateEditorSource; takenNames: string[] } | null> {
  const category = one(search.category);
  if (!category || !(TEMPLATE_CATEGORIES as readonly string[]).includes(category)) return null;
  const typedCategory = category as TemplateCategory;

  const language = draftLanguage(search, locale);
  const asked = one(search.preset);
  // A preset of another category is ignored: the draft is a blank canvas.
  const presetKey = isPresetKey(asked) && TEMPLATE_PRESETS[asked].category === typedCategory ? asked : undefined;

  const t = await getTranslations({ locale, namespace: "admin.invoiceTemplates.draft" });
  const existing = await listTemplates(owner, { category: typedCategory });
  const taken = new Set(existing.map((template) => templateNameKey(template.name)));
  const base = presetKey ? presetName(presetKey, language) : t("blankName");

  return {
    takenNames: existing.map((template) => template.name),
    source: {
      kind: "draft",
      category: typedCategory,
      presetKey,
      design: presetKey ? buildPresetDesign(presetKey, language) : blankDesign(typedCategory, language),
      suggestedName: freeTemplateName(base, (name) => taken.has(templateNameKey(name))),
    },
  };
}

/**
 * The preview's query (§7 Phase 2): `?id=` one of the owner's saved
 * templates, or `?preset=&lang=` a built-in preset; `?items=` the sample
 * order's length (1–200, default 3); `?order=` a real order by number or id,
 * read later through the scope's `print-context`. Null for an `id` the owner
 * doesn't have (the page's 404).
 */
export async function previewPageSource(
  owner: TemplateOwner,
  { locale, search }: { locale: string; search: Search },
): Promise<{ source: PreviewSource; items: number; order: string | null } | null> {
  const items = Math.min(MAX_SAMPLE_ITEMS, Math.max(1, Math.round(Number(one(search.items)) || 3)));
  const order = one(search.order)?.trim() || null;
  const id = one(search.id);

  if (id) {
    try {
      const template = await getTemplate(owner, id);
      return {
        items,
        order,
        source: {
          kind: "template",
          id: template.id,
          name: template.name,
          category: template.category,
          design: { locale: template.locale, canvas: template.canvas, format: template.format, elements: template.elements },
        },
      };
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }
  const preset = one(search.preset);
  return {
    items,
    order,
    source: { kind: "preset", preset: isPresetKey(preset) ? preset : "minimal", lang: draftLanguage(search, locale) },
  };
}
