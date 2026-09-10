"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  Settings,
  FolderSearch,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NotFoundIllustration } from "@/components/errors/not-found-illustration";
import { BackButton } from "@/components/errors/back-button";

const quickLinks = [
  {
    href: "/admin/dashboard",
    icon: LayoutDashboard,
    labelKey: "navigation.dashboard",
    defaultLabel: "Dashboard",
    description: "View analytics and overview",
  },
  {
    href: "/admin/products",
    icon: Package,
    labelKey: "navigation.products",
    defaultLabel: "Products",
    description: "Manage your products",
  },
  {
    href: "/admin/orders",
    icon: ShoppingCart,
    labelKey: "navigation.orders",
    defaultLabel: "Orders",
    description: "View and manage orders",
  },
  {
    href: "/admin/users",
    icon: Users,
    labelKey: "navigation.users",
    defaultLabel: "Users",
    description: "Manage users",
  },
  {
    href: "/admin/settings",
    icon: Settings,
    labelKey: "navigation.settings",
    defaultLabel: "Settings",
    description: "Configure your store",
  },
];

export default function AdminNotFound() {
  const t = useTranslations();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-4">
        {/* Illustration */}
        <div className="flex justify-center">
          <NotFoundIllustration variant="admin" className="w-64 h-48" />
        </div>

        {/* Content */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-sm font-medium">
            <FolderSearch className="size-4" aria-hidden="true" />
            <span>Admin Panel</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("errors.pageNotFound")}
          </h1>
          <p className="text-muted-foreground text-base max-w-md mx-auto">
            {t("errors.adminPageNotFoundDescription")}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <BackButton
            label={t("common.goBack")}
            className="w-full sm:w-auto"
          />
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/${locale}/admin/dashboard`}>
              <LayoutDashboard className="size-4" aria-hidden="true" />
              {t("common.backToDashboard")}
            </Link>
          </Button>
        </div>

        {/* Quick Links */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground text-center">
            {t("common.quickLinks")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={`/${locale}${link.href}`}
                className="group"
              >
                <Card className="h-full transition-all duration-200 hover:bg-accent hover:border-accent-foreground/20 group-focus-visible:ring-2 group-focus-visible:ring-ring">
                  <CardContent className="flex items-center gap-3">
                    <div className="shrink-0 size-9 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <link.icon
                        className="size-4 text-muted-foreground group-hover:text-primary transition-colors"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {t(link.labelKey, { defaultMessage: link.defaultLabel })}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {link.description}
                      </p>
                    </div>
                    <ChevronRight
                      className="size-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0"
                      aria-hidden="true"
                    />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
