import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth/auth";
import { USER_ROLES } from "@/config/app.config";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";
import { isStaffRole } from "@/lib/access/staff-role";
import { sanitizeReturnPath } from "@/lib/auth/return-path";
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

  // Same-origin paths only: this lands straight after OAuth, so an unchecked
  // value would let a crafted login link bounce the fresh session anywhere.
  const redirectParam = sanitizeReturnPath(
    typeof sp.redirect === "string" ? sp.redirect : undefined,
  );
  if (redirectParam) redirect(redirectParam);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await localeHref(locale, "/login"));

  if (session.user.role === USER_ROLES.ADMIN) {
    redirect(await localeHref(locale, "/admin/dashboard"));
  }
  if (session.user.role === USER_ROLES.VENDOR) {
    const multiVendorEnabled = await isMultiVendorEnabled();
    redirect(
      await localeHref(
        locale,
        multiVendorEnabled ? "/vendor/dashboard" : "/account",
      ),
    );
  }
  if (isStaffRole(session.user.role)) {
    redirect(await localeHref(locale, "/staff/dashboard"));
  }
  redirect(await localeHref(locale, "/account"));
}
