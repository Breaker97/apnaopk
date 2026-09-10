import { setRequestLocale } from "next-intl/server";
import { CollectionForm } from "@/components/admin/collection-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditCollectionPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <CollectionForm collectionId={id} />;
}
