import { setRequestLocale } from "next-intl/server";
import { BlogPostForm } from "@/components/admin/blog/blog-post-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditBlogPostPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return <BlogPostForm postId={id} />;
}
