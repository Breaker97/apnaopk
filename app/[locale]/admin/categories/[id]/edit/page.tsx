import { setRequestLocale } from "next-intl/server";
import { CategoryForm } from "@/components/admin/category-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditCategoryPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <CategoryForm categoryId={id} />;
}
