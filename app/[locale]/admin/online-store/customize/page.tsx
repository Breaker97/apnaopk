import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { connectDB } from "@/lib/db";
import {
  isDemoModeEnabled,
  STORE_BUILDER_DEMO_MODE_MESSAGE,
} from "@/lib/demo-mode";
import { normalizeHomePageSettings } from "@/lib/site-config/home-page-config";
import {
  buildDefaultGroupSections,
  buildDefaultTemplateSections,
  readLegacyGalleryLayout,
} from "@/lib/storefront/pages/default-templates";
import { homePageSettingsToSections } from "@/lib/storefront/pages/legacy-home";
import { sectionsEqual } from "@/lib/storefront/pages/lifecycle";
import {
  resolveAdminPageRef,
  type AdminPageRef,
} from "@/lib/storefront/pages/handles";
import { getSectionCatalog } from "@/lib/storefront/sections/catalog";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import { normalizeSectionInstance } from "@/lib/storefront/sections/normalize";
import { getSectionDefinition } from "@/lib/storefront/sections/registry";
import { lt } from "@/lib/storefront/sections/localized";
import type {
  LocalizedText,
  SectionInstance,
} from "@/lib/storefront/sections/types";
import {
  getActiveThemeManifest,
  resolveActiveTheme,
} from "@/lib/storefront/themes/registry";
import { getSettings } from "@/models/settings.model";
import { StorePage } from "@/models/store-page.model";
import {
  buildPageSwitcher,
  loadPageSwitcherLandingPages,
} from "@/lib/storefront/pages/page-switcher";
import { StorePageBuilder } from "@/components/admin/store-pages/store-page-builder";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}

/**
 * The unified storefront editor — Shopify's "Customize" pattern. ONE route
 * for every section-built surface; the `?page=` ref (resolved by
 * `resolveAdminPageRef`) selects the home template, the product template,
 * or a landing page, and the in-builder switcher moves between them. New
 * templates join the switcher, never the sidebar.
 */
export default async function CustomizePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  const { page: pageParam } = await searchParams;
  const ref = resolveAdminPageRef(pageParam ?? "home");
  if (!ref) notFound();

  await connectDB();
  const t = await getTranslations({ locale });
  // Started here so it overlaps the settings and page reads instead of
  // queueing behind them: the switcher's labels need the default language,
  // its rows do not. The handler below only keeps a rejection from surfacing
  // as an unhandled one if the reads above fail first; the await still throws.
  const landingPages = loadPageSwitcherLandingPages();
  landingPages.catch(() => undefined);
  const [settings, doc] = await Promise.all([
    getSettings(),
    StorePage.findOne({ key: ref.key }).select("title draft published").lean(),
  ]);

  const defaultLanguage = settings.general?.defaultLanguage || "en";
  const supported = settings.general?.supportedLanguages ?? [];
  const languages = supported.includes(defaultLanguage)
    ? supported
    : [defaultLanguage, ...supported];
  const isMultiVendorEnabled = Boolean(settings.multiVendorMode?.enabled);

  // Landing pages must exist (created from the Pages screen); templates
  // open on their built-in defaults until first saved.
  if (ref.parsed.kind === "landing" && !doc) notFound();

  const { draftSections, heading } = resolveInitialState(
    ref,
    doc,
    settings,
    t,
    defaultLanguage,
  );

  const isPublished = Boolean(doc?.published);
  const hasUnpublishedChanges = isPublished
    ? !sectionsEqual(
        draftSections,
        sanitizeSectionInstances(doc?.published?.sections),
      )
    : true;

  const templateType =
    ref.parsed.kind === "template" ? ref.parsed.templateType : undefined;
  const zone = ref.parsed.kind === "group" ? ref.parsed.group : "template";

  // One catalog, filtered for the surface being edited: template-bound
  // sections only appear on their template (never on landing pages), and
  // zone-bound sections only inside their chrome group. The active theme's
  // preferred variants ride along so "Add section" inserts the template's
  // design, not the legacy default.
  const catalog = getSectionCatalog(
    { isMultiVendorEnabled },
    getActiveThemeManifest(resolveActiveTheme(settings.onlineStore).id)
      .preferredVariants,
  ).filter(
    (entry) => {
      if (!(entry.zones ?? ["template"]).includes(zone)) return false;
      if (zone !== "template") return true;
      return (
        !entry.templates ||
        (templateType && entry.templates.includes(templateType))
      );
    },
  );

  const switcher = await buildPageSwitcher(
    locale,
    pageParam ?? "home",
    defaultLanguage,
    landingPages,
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Keyed by page ref: the switcher navigates within this same route,
          and without a remount the builder's useState seeds would keep the
          previous page's sections until a hard refresh. */}
      <StorePageBuilder
        key={ref.key}
        locale={locale}
        handle={pageParam ?? "home"}
        heading={heading}
        switcher={switcher}
        initialSections={draftSections}
        initialIsPublished={isPublished}
        initialHasUnpublishedChanges={hasUnpublishedChanges}
        catalog={catalog}
        languages={languages}
        defaultLanguage={defaultLanguage}
        demoMode={{
          enabled: isDemoModeEnabled(),
          message: STORE_BUILDER_DEMO_MODE_MESSAGE,
        }}
      />
    </div>
  );
}

/**
 * Bring stored instances up to the CURRENT definitions before the builder
 * shows them.
 *
 * Rendering already migrates on read, and every save migrates on write — so
 * an editor left on the raw document is the only surface seeing the old
 * shape. That gap is not cosmetic: a merchant would edit fields the
 * migration has not filled in yet and their first autosave would write that
 * view back, undoing the migration. Normalizing here means the form, the
 * preview and the next save all agree. An unknown type keeps its instance
 * untouched — the picker will not offer it, but nothing is dropped.
 */
function migrateForEditor(sections: SectionInstance[]): SectionInstance[] {
  return sections.map((instance) => {
    const def = getSectionDefinition(instance.type);
    return def ? normalizeSectionInstance(def, instance) : instance;
  });
}

function resolveInitialState(
  ref: AdminPageRef,
  doc: {
    title?: unknown;
    draft?: { sections?: unknown[] };
    published?: { sections?: unknown[] } | null;
  } | null,
  settings: Awaited<ReturnType<typeof getSettings>>,
  t: Awaited<ReturnType<typeof getTranslations>>,
  defaultLanguage: string,
): { draftSections: SectionInstance[]; heading: string | undefined } {
  const stored = doc?.draft?.sections ?? doc?.published?.sections;
  if (Array.isArray(stored)) {
    return {
      draftSections: migrateForEditor(sanitizeSectionInstances(stored)),
      heading: resolveHeading(ref, doc, t, defaultLanguage),
    };
  }

  // No document yet — each surface's faithful "what the store shows today":
  if (ref.parsed.kind === "group") {
    return {
      draftSections: buildDefaultGroupSections(ref.parsed.group),
      heading: resolveHeading(ref, doc, t, defaultLanguage),
    };
  }
  if (ref.parsed.kind === "template" && ref.parsed.templateType !== "home") {
    const theme = resolveActiveTheme(settings.onlineStore);
    const defaults = buildDefaultTemplateSections(ref.parsed.templateType, {
      galleryLayout: readLegacyGalleryLayout(settings.onlineStore, theme.id),
    });
    return {
      draftSections: defaults ?? [],
      heading: resolveHeading(ref, doc, t, defaultLanguage),
    };
  }
  return {
    draftSections: homePageSettingsToSections(
      normalizeHomePageSettings(settings.homePage),
    ),
    heading: resolveHeading(ref, doc, t, defaultLanguage),
  };
}

function resolveHeading(
  ref: AdminPageRef,
  doc: { title?: unknown } | null,
  t: Awaited<ReturnType<typeof getTranslations>>,
  defaultLanguage: string,
): string | undefined {
  if (ref.parsed.kind === "landing") {
    return (
      lt((doc?.title as LocalizedText) ?? "", defaultLanguage, defaultLanguage) ||
      ref.parsed.handle
    );
  }
  if (ref.parsed.kind === "group") {
    const key = `admin.storeBuilder.switcher.${ref.parsed.group}`;
    const fallback = ref.parsed.group === "header" ? "Header" : "Footer";
    return t.has(key) ? t(key as never) : fallback;
  }
  if (ref.parsed.kind === "template" && ref.parsed.templateType !== "home") {
    const fallbacks: Record<string, string> = {
      product: "Product details",
      products: "Product listing",
      category: "Category page",
      collection: "Collection page",
      cart: "Cart",
    };
    const key = `admin.storeBuilder.switcher.${ref.parsed.templateType}`;
    return t.has(key)
      ? t(key as never)
      : (fallbacks[ref.parsed.templateType] ?? ref.parsed.templateType);
  }
  // Home keeps the builder's default heading.
  return undefined;
}
