import { setRequestLocale } from "next-intl/server";
import { BlogCategoriesDataTable } from "@/components/admin/blog/blog-categories-data-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminBlogCategoriesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return (
    <div className="space-y-4">
      <BlogCategoriesDataTable locale={locale} />
    </div>
  );
}
