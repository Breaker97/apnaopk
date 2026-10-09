"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAdminSettings } from "./use-admin-settings";
import { useUnsavedChangesGuard } from "./use-unsaved-navigation";
import type { AdminSettingsSectionId } from "./settings-sections";

type AdminSettingsContextValue = ReturnType<typeof useAdminSettings>;

const AdminSettingsContext = createContext<AdminSettingsContextValue | null>(
  null,
);

export function AdminSettingsProvider({
  children,
  initialSettings,
}: {
  children: ReactNode;
  initialSettings?: unknown;
}) {
  const value = useAdminSettings(initialSettings);
  // Wherever the settings are edited, leaving asks before it drops the edits.
  useUnsavedChangesGuard(value.hasUnsaved(), value.discardEdits);
  return (
    <AdminSettingsContext.Provider value={value}>
      {children}
    </AdminSettingsContext.Provider>
  );
}

export function useAdminSettingsContext(): AdminSettingsContextValue {
  const ctx = useContext(AdminSettingsContext);
  if (!ctx) {
    throw new Error(
      "useAdminSettingsContext must be used within AdminSettingsProvider",
    );
  }
  return ctx;
}

/**
 * For a panel on a settings page that loads and saves on its own, beside the
 * settings document (Messaging's live chat): its unsaved edits count as the
 * page's, so leaving asks first and the sidebar marks the page "Unsaved".
 * Does nothing outside the settings provider.
 */
export function useReportUnsavedPanel(
  sectionId: AdminSettingsSectionId,
  unsaved: boolean,
) {
  const setPanelUnsaved = useContext(AdminSettingsContext)?.setPanelUnsaved;
  useEffect(() => {
    if (!setPanelUnsaved) return;
    setPanelUnsaved(sectionId, unsaved);
    return () => setPanelUnsaved(sectionId, false);
  }, [setPanelUnsaved, sectionId, unsaved]);
}
