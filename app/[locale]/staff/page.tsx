import { redirect } from "next/navigation";

export default async function StaffRootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/staff/dashboard`);
}

