"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, LayoutTemplate, ListTree, PanelBottom } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createTSafe } from "@/components/admin/online-store/t-safe";

/**
 * The Navigation landing: one card per navigation surface, each opening its
 * dedicated editor. Replaces the old generic menus table — the storefront
 * has exactly these three navigation surfaces, so a list you could add
 * arbitrary menus to only created rows nothing rendered.
 */
export function NavigationHub({ locale }: { locale: string }) {
  const tSafe = createTSafe(useTranslations());

  const surfaces = [
    {
      key: "header",
      href: `/${locale}/admin/online-store/menus/header`,
      icon: LayoutTemplate,
      title: tSafe("admin.navigationHub.header.title", "Header"),
      description: tSafe(
        "admin.navigationHub.header.description",
        "Pick a header style and configure the announcement bar, menu links, search, and action buttons.",
      ),
    },
    {
      key: "footer",
      href: `/${locale}/admin/online-store/menus/footer`,
      icon: PanelBottom,
      title: tSafe("admin.navigationHub.footer.title", "Footer"),
      description: tSafe(
        "admin.navigationHub.footer.description",
        "Link columns, contact details, social links, and the payment strip.",
      ),
    },
    {
      key: "megaMenu",
      href: `/${locale}/admin/online-store/menus/main-mega-menu/edit`,
      icon: ListTree,
      title: tSafe("admin.navigationHub.megaMenu.title", "Mega Menu"),
      description: tSafe(
        "admin.navigationHub.megaMenu.description",
        "The All Categories rail: build category flyouts with links, images, and promos.",
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {tSafe("admin.navigationHub.title", "Navigation")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {tSafe(
            "admin.navigationHub.description",
            "Choose a navigation surface to customize.",
          )}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {surfaces.map((surface) => (
          <Link key={surface.key} href={surface.href} className="group">
            <Card className="h-full gap-3 transition-colors group-hover:border-primary/50">
              <CardHeader>
                <span className="mb-2 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <surface.icon className="h-5 w-5" />
                </span>
                <CardTitle className="flex items-center justify-between gap-2">
                  {surface.title}
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180" />
                </CardTitle>
                <CardDescription>{surface.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
