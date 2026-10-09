import { setRequestLocale } from "next-intl/server";
import { MenuForm } from "@/components/admin/menus/menu-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditMenuPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return (
    <div className="w-full">
      <MenuForm menuId={id} />
    </div>
  );
}
