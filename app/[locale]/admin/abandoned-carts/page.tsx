import "server-only";
import { redirect } from "next/navigation";

export default async function AbandonedCartsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale || "en"}/admin/abandoned-checkouts`);
}
