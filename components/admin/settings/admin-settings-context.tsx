"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAdminSettings } from "./use-admin-settings";

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
