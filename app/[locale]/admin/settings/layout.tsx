import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { SettingsShell } from "@/components/admin/settings/settings-shell";
import { getSanitizedSettings } from "@/lib/settings/sanitize-settings";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function AdminSettingsLayout({
  children,
  params,
}: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  // Seed the client settings store server-side so every settings page renders
  // its real (dynamic) data on first paint — no client round-trip, no skeleton
  // flash. Falls back to the client fetch when this returns null.
  const initialSettings = await getSanitizedSettings();

  return (
    <SettingsShell locale={locale} initialSettings={initialSettings}>
      {children}
    </SettingsShell>
  );
}
