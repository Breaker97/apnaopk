"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { USER_ROLES } from "@/config/app.config";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { isStaffRole } from "@/lib/access/staff-role";
import { signOutAndReload } from "@/lib/auth/auth-client";

/**
 * What checkout shows an admin, a team member or a seller in place of the
 * form. The store takes orders from customer accounts only — the payment
 * routes refuse the rest (lib/checkout/shopper-account.ts) — and an order for
 * someone else is made in the dashboard: Create order for an admin or a
 * seller. A team member has no such page and the admin one is not theirs, so
 * theirs is the dashboard.
 *
 * `role` is the account's role as the header reads it; the legacy `seller`
 * role is a team member's.
 */
export function StaffCheckoutNotice({
  locale,
  role,
}: {
  locale: string;
  role: string;
}) {
  const t = useTranslations();
  const tr = useFallbackTranslator(t);
  const [signingOut, setSigningOut] = useState(false);

  const createOrder = tr("checkout.staffNotice.createOrder", "Create order");
  const { title, action, href } =
    role === USER_ROLES.ADMIN
      ? {
          title: tr("checkout.staffNotice.adminTitle", "You're signed in as an admin"),
          action: createOrder,
          href: `/${locale}/admin/orders/create`,
        }
      : role === USER_ROLES.VENDOR
        ? {
            title: tr("checkout.staffNotice.vendorTitle", "You're signed in as a seller"),
            action: createOrder,
            href: `/${locale}/vendor/orders/create`,
          }
        : {
            title: tr(
              "checkout.staffNotice.staffTitle",
              "You're signed in as a team member",
            ),
            action: tr("checkout.staffNotice.goToDashboard", "Go to dashboard"),
            href: getRoleDashboardPath(
              locale,
              isStaffRole(role) ? role : USER_ROLES.STAFF,
            ) as string,
          };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16">
      <Card className="w-full gap-5 text-center">
        <CardHeader className="gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <CardDescription className="text-base">
            {tr(
              "checkout.staffNotice.body",
              "Orders on the store are placed from a customer account.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href={href}>{action}</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await signOutAndReload(locale);
              } catch {
                setSigningOut(false);
              }
            }}
          >
            {tr("checkout.staffNotice.signOut", "Sign out")}
          </Button>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-xs text-muted-foreground">
            {tr(
              "checkout.staffNotice.hint",
              "To test checkout, sign out and use a different email.",
            )}
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
