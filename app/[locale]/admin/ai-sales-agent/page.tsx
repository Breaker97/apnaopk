import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { AISalesAgentAdmin } from "@/components/admin/ai-sales-agent-admin";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { resolveActiveTheme } from "@/lib/storefront/themes/registry";
import { compileTheme } from "@/lib/storefront/themes/compile";
import { resolveBrand } from "@/lib/branding/brand";
import { themeRefChoices } from "@/lib/theme-colors/theme-refs";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminAISalesAgentPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  // The active theme's colours, so the widget's colours can follow it.
  await connectDB();
  const settings = await getSettings();
  const theme = resolveActiveTheme(settings.onlineStore);
  const themeColors = themeRefChoices(
    compileTheme(theme.tokens, resolveBrand(settings).colors).vars,
  );
  return <AISalesAgentAdmin locale={locale} themeColors={themeColors} />;
}
