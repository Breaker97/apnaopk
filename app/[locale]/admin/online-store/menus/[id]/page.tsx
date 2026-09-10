import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function MenuDetailRedirectPage({ params }: PageProps) {
  const { locale, id } = await params;
  redirect(
    `/${locale}/admin/online-store/menus/${encodeURIComponent(id)}/edit`,
  );
}
