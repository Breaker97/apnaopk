import { setRequestLocale } from "next-intl/server";
import { SlidersManager } from "@/components/admin/sliders/sliders-manager";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { resolveBrand } from "@/lib/branding/brand";
import { compileTheme } from "@/lib/storefront/themes/compile";
import { resolveActiveTheme } from "@/lib/storefront/themes/registry";
import { getSettings } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminSlidersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  // The active theme, compiled, so the slide canvas and every preview stand
  // on the storefront's own ground — its fonts and button styling — and a
  // slide edited here is the slide that ships.
  const settings = await getSettings();
  const theme = resolveActiveTheme(settings.onlineStore);
  const surface = compileTheme(theme.tokens, resolveBrand(settings).colors);
  // The store's languages, the default first, so slide copy can be
  // translated where there is more than one.
  const defaultLanguage = settings.general?.defaultLanguage || "en";
  const supported: string[] = settings.general?.supportedLanguages ?? [];
  const languages = supported.includes(defaultLanguage)
    ? [defaultLanguage, ...supported.filter((code) => code !== defaultLanguage)]
    : [defaultLanguage, ...supported];

  return (
    <div className="w-full space-y-4">
      <SlidersManager
        locale={locale}
        storeSurface={{ vars: surface.vars, attributes: surface.attributes }}
        languages={languages}
        defaultLanguage={defaultLanguage}
      />
    </div>
  );
}
