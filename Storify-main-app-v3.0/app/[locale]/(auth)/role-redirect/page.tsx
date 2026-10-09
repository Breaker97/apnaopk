import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth/auth";
import { getPostLoginDestination } from "@/lib/auth/post-login-destination";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { localeHref } from "@/lib/i18n/locale-routing";

export default async function RoleRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const returnTo = typeof sp.redirect === "string" ? sp.redirect : undefined;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect(await localeHref(locale, buildLoginUrl(locale, returnTo)));
  }

  // The return path is checked in there — same-origin paths only. This lands
  // straight after OAuth, so an unchecked value would let a crafted login
  // link bounce the fresh session anywhere.
  redirect(
    await getPostLoginDestination({
      locale,
      role: session.user.role,
      returnTo,
    }),
  );
}
