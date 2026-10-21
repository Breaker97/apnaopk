import { TaxSettingsPage } from "@/components/admin/settings/sections/tax/tax-settings-tab";
import { loadTaxUsage } from "@/lib/tax/tax-usage";

/**
 * Settings → Tax. The Rates tab's catalog counts are read once, as the page
 * opens; without them the page still works and the tab leaves them out.
 */
export default async function Page() {
  const usage = await loadTaxUsage().catch((error) => {
    console.error("Failed to count the catalog's tax classes:", error);
    return null;
  });
  return <TaxSettingsPage usage={usage} />;
}
