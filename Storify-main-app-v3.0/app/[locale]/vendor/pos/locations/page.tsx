import { redirect } from "next/navigation";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Kept only so bookmarks survive.
 *
 * Locations moved out of POS to `/vendor/locations`: gating them on the
 * register meant a vendor who does not sell in person could not record a
 * warehouse, and nothing but POS ever linked here anyway.
 */
export default async function VendorPosLocationsPage({ params }: PageProps) {
  const { locale } = await params;
  redirect(await localeHref(locale, "/vendor/locations"));
}
