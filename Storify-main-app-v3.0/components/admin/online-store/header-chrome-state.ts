import type { SectionInstance } from "@/lib/storefront/sections/types";
import type { LocalizedText } from "@/lib/storefront/sections/types";
import { lt } from "@/lib/storefront/sections/localized";
import {
  hasBackground,
  normalizeBackground,
  type SlideBackground,
} from "@/lib/sliders/types";
import {
  readAnnouncementStyle,
  writeAnnouncementStyle,
  type AnnouncementStyle,
} from "@/lib/site-config/announcement-style";

/**
 * The announcement bar is a section instance on the header GROUP document
 * (that's what keeps it theme-preset-able and per-locale), but the header
 * editor surfaces it as plain settings. These helpers are that bridge: read
 * the instance into flat editor state, write editor changes back into the
 * sections array without disturbing anything else on the document.
 */

export interface AnnouncementDraft {
  enabled: boolean;
  text: string;
  url: string;
  /** Solid, gradient or image; `{ type: "solid" }` alone means the theme's primary. */
  background: SlideBackground;
  /** Height, alignment and the message's type — see AnnouncementStyle. */
  style: AnnouncementStyle;
}

function findSection(sections: SectionInstance[], type: string) {
  return sections.find((section) => section.type === type);
}

/**
 * Write a translatable field: plain strings stay plain, per-locale records
 * keep their other translations and take the new copy on the admin default
 * language.
 */
function setLocalized(
  existing: unknown,
  language: string,
  value: string,
): LocalizedText {
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return { ...(existing as Record<string, string>), [language]: value };
  }
  return value;
}

function isAnnouncementEmpty(draft: AnnouncementDraft): boolean {
  return (
    !draft.text.trim() &&
    !draft.url.trim() &&
    !hasBackground(draft.background) &&
    !draft.style.height &&
    !hasBackground(draft.style.textStyle.fill)
  );
}

/**
 * The bar's background, from either shape a stored instance may carry: the
 * `background` object, or the `backgroundColor` hex the definition's first
 * version stored (the section's migrate hook folds it in on save, but a
 * draft loaded straight off the document still has the old key).
 */
function readAnnouncementBackground(
  settings: Record<string, unknown>,
): SlideBackground {
  if (settings.background && typeof settings.background === "object") {
    return normalizeBackground(settings.background);
  }
  return typeof settings.backgroundColor === "string" &&
    settings.backgroundColor
    ? normalizeBackground({ type: "solid", color: settings.backgroundColor })
    : { type: "solid" };
}

export function readAnnouncement(
  sections: SectionInstance[],
  language: string,
): AnnouncementDraft {
  const section = findSection(sections, "announcement-bar");
  const settings = section?.settings ?? {};
  return {
    enabled: Boolean(section && section.visible),
    text: lt(settings.text as LocalizedText, language, language),
    url: typeof settings.url === "string" ? settings.url : "",
    background: readAnnouncementBackground(settings),
    style: readAnnouncementStyle(settings),
  };
}

export function writeAnnouncement(
  sections: SectionInstance[],
  draft: AnnouncementDraft,
  language: string,
): SectionInstance[] {
  const existing = findSection(sections, "announcement-bar");

  if (!existing) {
    // A hidden, empty bar has nothing to store. A hidden bar WITH copy is
    // kept (as a hidden instance): the studio lets a merchant type the text
    // before switching the row on, and dropping it here would lose the
    // draft the moment they blurred the field.
    if (!draft.enabled && isAnnouncementEmpty(draft)) return sections;
    // Above the header bar, where the storefront renders it.
    const instance: SectionInstance = {
      id: crypto.randomUUID(),
      type: "announcement-bar",
      version: 3,
      visible: draft.enabled,
      settings: {
        text: draft.text,
        url: draft.url,
        background: draft.background,
        ...writeAnnouncementStyle(draft.style),
      },
    };
    return [instance, ...sections];
  }

  return sections.map((section) =>
    section === existing
      ? {
          ...section,
          visible: draft.enabled,
          settings: {
            ...section.settings,
            text: setLocalized(section.settings.text, language, draft.text),
            url: draft.url,
            background: draft.background,
            ...writeAnnouncementStyle(draft.style),
          },
        }
      : section,
  );
}

