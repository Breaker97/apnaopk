"use client";

import { useEffect, type ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { useTranslations } from "next-intl";
import { WarningBanner } from "@/components/ui/warning-banner";
import { usePathname } from "@/hooks/use-locale-navigation";
import { splitLocalePath } from "@/lib/i18n/locale-prefix";
import { cn } from "@/lib/utils";
import {
  ADMIN_SETTINGS_SECTIONS,
  adminSettingsSectionFromPath,
  getSectionStatus,
  isAdminSettingsSectionDirty,
} from "@/components/admin/settings/settings-sections";
import {
  AdminSettingsProvider,
  useAdminSettingsContext,
} from "@/components/admin/settings/admin-settings-context";
import { publishSettingsNavStatus } from "@/components/admin/settings/settings-nav-status";

/**
 * The frame every admin settings page renders in. Settings open inside the
 * dashboard rather than over it: the dashboard sidebar swaps its menu for the
 * settings menu (`AdminSettingsSidebarNav`), and this is the column beside it.
 * Leaving with unsaved edits asks first through the provider's own guard.
 */
export function SettingsShell({
  children,
  initialSettings,
}: {
  children: ReactNode;
  initialSettings?: unknown;
}) {
  return (
    <AdminSettingsProvider initialSettings={initialSettings}>
      <SettingsShellInner>{children}</SettingsShellInner>
    </AdminSettingsProvider>
  );
}

function SettingsShellInner({ children }: { children: ReactNode }) {
  const t = useTranslations("admin.settings");
  const pathname = usePathname();
  const {
    settings,
    dirtySections,
    unsavedPanels,
    isDemoMode,
    demoModeMessage,
  } = useAdminSettingsContext();

  // "Unsaved" and "Needs attention" beside each entry of the sidebar's
  // settings menu. "Needs attention" is enabled-but-not-configured (a gateway
  // with no secret, SMTP with no login, shipping with no zones…) or a state
  // worth a glance (maintenance mode on); tests/payment-gateway-registry.test.ts
  // guards the gateway list `getSectionStatus` reads.
  useEffect(() => {
    publishSettingsNavStatus({
      dirty: new Set(
        ADMIN_SETTINGS_SECTIONS.filter(
          (section) =>
            isAdminSettingsSectionDirty(section.id, dirtySections) ||
            unsavedPanels.has(section.id),
        ).map((section) => section.id),
      ),
      attention: new Set(
        settings
          ? ADMIN_SETTINGS_SECTIONS.filter(
              (section) => getSectionStatus(section.id, settings) === "warning",
            ).map((section) => section.id)
          : [],
      ),
    });
  }, [settings, dirtySections, unsavedPanels]);
  useEffect(() => () => publishSettingsNavStatus(null), []);

  // Demo mode locks the settings forms read-only, but the storage section
  // owns the Media Library — a browse surface that must stay interactive
  // (open, search, filter, preview) even in demo. That page applies its own
  // read-only treatment to just the storage config form, so exclude it from
  // the blanket lock here. The Activity Log is the same kind of page: nothing
  // on it saves, and a disabled fieldset would switch off its filters.
  const section = adminSettingsSectionFromPath(splitLocalePath(pathname).rest);
  const locked = isDemoMode && section !== "storage" && section !== "activityLog";

  return (
    // Settings are forms, so a narrow column. The log is a table of six
    // columns and does not fit in one.
    <div
      className={cn(
        "mx-auto w-full",
        section !== "activityLog" && "max-w-4xl",
      )}
    >
      {isDemoMode && (
        <WarningBanner icon={LockKeyhole} title={t("demoMode")} className="mb-4">
          {demoModeMessage}
        </WarningBanner>
      )}
      <fieldset
        disabled={locked}
        className={cn(
          "min-w-0 space-y-4 border-0 p-0",
          locked && "opacity-75",
        )}
      >
        {children}
      </fieldset>
    </div>
  );
}
