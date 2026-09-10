import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LocationsContent } from "@/components/pos/locations-content";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * A vendor's own shops, warehouses and collection points.
 *
 * Deliberately gated on nothing but being a merchant with dashboard access.
 * This list used to live only under POS, which meant a store with the register
 * switched off — or a vendor without `access_pos` — had no way at all to say
 * where their stock is kept, even though inventory, the product form, the
 * dispatch order and storefront pickup all read it. `/api/admin/locations`
 * already takes that stance ("no separate permission for it"); this page is
 * what makes the UI agree with it.
 *
 * No `required` permissions are passed, so the guard returns rather than
 * redirects for a vendor still behind the payment gate — hence the explicit
 * `hasDashboardAccess` check, which is the same redirect a permission-naming
 * caller would have got.
 */
export default async function VendorLocationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({ locale });
  if (!access.hasDashboardAccess) {
    redirect(`/${locale}/vendor/dashboard`);
  }

  return <LocationsContent />;
}
