"use client";

import { MetaCatalogSettingsTab } from "@/components/admin/settings/sections/meta-catalog-settings-tab";

/**
 * Not a section of the settings document: the feed keeps its own record
 * (models/meta-catalog-feed.model.ts) and its own admin API, so the page
 * loads and saves through that rather than SectionLoader/saveSection.
 */
export default function Page() {
  return <MetaCatalogSettingsTab />;
}
