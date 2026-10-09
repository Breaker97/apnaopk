import { setRequestLocale } from "next-intl/server";
import { BlogCommentsDataTable } from "@/components/admin/blog/blog-comments-data-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminBlogCommentsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return (
    <div className="space-y-4">
      <BlogCommentsDataTable locale={locale} />
    </div>
  );
}
