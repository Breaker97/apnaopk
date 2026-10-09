import { setRequestLocale } from "next-intl/server";
import { BlogCategoryForm } from "@/components/admin/blog/blog-category-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditBlogCategoryPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return <BlogCategoryForm categoryId={id} />;
}
