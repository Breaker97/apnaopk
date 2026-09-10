import { setRequestLocale } from "next-intl/server";
import { LocationsContent } from "@/components/pos/locations-content";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The house store's shops, warehouses and collection points.
 *
 * The admin counterpart of `/vendor/locations`, and gated the same way: on
 * being able to manage inventory, not on POS. This list used to exist only in
 * two half-places — a cut-down tab under Settings that could edit four of the
 * record's fields, and the full editor buried under POS, which redirects away
 * entirely when the register is switched off. An admin with POS disabled was
 * therefore left with the cut-down one, unable to publish a collection point,
 * set opening hours, or place a map pin, with nothing on screen to say so.
 *
 * `/admin/pos/locations` redirects here.
 */
export default async function AdminLocationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.MANAGE_INVENTORY],
  });

  return <LocationsContent />;
}
