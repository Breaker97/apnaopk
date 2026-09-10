import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { InstallWizard } from "@/components/install/install-wizard";
import { isInstalled } from "@/lib/install/status";
import { themePreviewSrc } from "@/lib/storefront/themes/preview";
import { THEME_MANIFESTS } from "@/lib/storefront/themes/registry";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Never indexed: the wizard exists for exactly one visit per store. */
export const metadata: Metadata = {
  title: "Install",
  robots: { index: false, follow: false },
};

/**
 * The one-time installation wizard. Hard-locked server-side: the moment the
 * store has an admin (or the finish step has stamped the settings document)
 * this page — and every /api/install route behind it — answers 404, so a
 * live store never exposes a setup surface.
 */
export default async function InstallPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // A database that cannot be read is the single most likely reason a buyer
  // opens this page at all, and letting the lock check throw turns that into
  // a bare 500 — the one screen that explains the problem, refusing to
  // render because of the problem. Fall open to the wizard instead: it shows
  // the failed check and blocks the install, and nothing is exposed by doing
  // so, because every /api/install route re-checks the lock server-side and
  // none of them can do anything without the database either.
  if (await isInstalled().catch(() => false)) notFound();

  return (
    <InstallWizard
      locale={locale}
      templates={THEME_MANIFESTS.filter(
        (manifest) => manifest.status === "stable",
      ).map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        accent: manifest.accent,
        preview: themePreviewSrc(manifest, "card"),
      }))}
    />
  );
}
