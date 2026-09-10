import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { CollectionForm } from "@/components/admin/collection-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewCollectionPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <CollectionForm />;
}
