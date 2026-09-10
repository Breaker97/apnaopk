import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ locale: string; handle: string }>;
}

/**
 * Pre-Customize landing builder URL. The unified editor owns landing pages
 * now — one builder mount, switched by ref.
 */
export default async function LandingPageBuilderPage({ params }: PageProps) {
  const { locale, handle } = await params;
  redirect(
    `/${locale}/admin/online-store/customize?page=${encodeURIComponent(handle)}`,
  );
}
