"use client";

import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { InvoiceTemplateManager } from "@/components/invoice-templates/manager";

/**
 * Settings → Invoice Settings. Thin: the manager owns the screen. The settings
 * shell leaves this page unlocked in demo mode, so the manager is told to
 * switch off what changes data and keep its tabs, Edit and Preview working.
 */
export default function Page() {
  const { isDemoMode, isLoading } = useAdminSettingsContext();
  return <InvoiceTemplateManager readOnly={isDemoMode || isLoading} />;
}
