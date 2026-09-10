import { setRequestLocale } from "next-intl/server";
import { SlidersManager } from "@/components/admin/sliders/sliders-manager";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminSlidersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <SlidersManager locale={locale} />
    </div>
  );
}
