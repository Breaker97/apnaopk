import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { HeaderStudio } from "@/components/admin/online-store/header-studio/header-studio";
import { getDraftGroupSections } from "@/lib/storefront/pages/get-template";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { resolveActiveTheme } from "@/lib/storefront/themes/registry";
import { compileTheme } from "@/lib/storefront/themes/compile";
import { resolveBrand } from "@/lib/branding/brand";
import { themeRefChoices } from "@/lib/theme-colors/theme-refs";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OnlineStoreMenusHeaderPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  // The announcement bar and the top tags strip are section instances on the
  // header group document. The studio shows them as pinned rows above and
  // below the layout, edits them in place, and publishes them back through
  // the group's draft → publish routes.
  const chromeSections = await getDraftGroupSections("header");
  // The active theme's colours, so a header colour can follow the theme
  // and the preview paints a followed colour as the store will.
  await connectDB();
  const settings = await getSettings();
  const theme = resolveActiveTheme(settings.onlineStore);
  const themeColors = themeRefChoices(
    compileTheme(theme.tokens, resolveBrand(settings).colors).vars,
  );

  return (
    <HeaderStudio
      initialChromeSections={JSON.parse(JSON.stringify(chromeSections))}
      themeColors={themeColors}
    />
  );
}
