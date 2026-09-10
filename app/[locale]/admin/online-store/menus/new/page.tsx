import { setRequestLocale } from "next-intl/server";
import { MenuForm } from "@/components/admin/menus/menu-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewMenuPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return (
    <div className="w-full">
      <MenuForm />
    </div>
  );
}
