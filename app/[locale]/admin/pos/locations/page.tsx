import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Kept only so bookmarks survive.
 *
 * Locations moved out of POS to `/admin/locations`: gating them on the register
 * meant a store with POS switched off could reach nothing but the cut-down
 * Settings tab, which cannot publish a collection point or set opening hours.
 */
export default async function AdminPosLocationsPage({ params }: PageProps) {
  const { locale } = await params;
  redirect(`/${locale}/admin/locations`);
}
