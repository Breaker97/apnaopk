import { setRequestLocale } from "next-intl/server";
import { NavigationHub } from "@/components/admin/menus/navigation-hub";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminMenusPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <NavigationHub locale={locale} />
    </div>
  );
}
