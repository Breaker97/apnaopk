import { setRequestLocale } from "next-intl/server";
import { BlogPostForm } from "@/components/admin/blog/blog-post-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewBlogPostPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return <BlogPostForm />;
}
