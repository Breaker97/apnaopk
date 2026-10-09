import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  return <VerifyEmailPanel locale={locale} email={query.email || ""} />;
}
