import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { FileText, ListTree, Palette, PanelsTopLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const channelSections = [
  {
    key: "customize",
    href: "/admin/online-store/customize",
    icon: PanelsTopLeft,
  },
  {
    key: "themes",
    href: "/admin/online-store/theme",
    icon: Palette,
  },
  {
    key: "pages",
    href: "/admin/online-store/pages",
    icon: FileText,
  },
  {
    key: "menus",
    href: "/admin/online-store/menus",
    icon: ListTree,
  },
];

export default async function OnlineStorePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);
  const t = await getTranslations({ locale, namespace: "admin.onlineStorePage" });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-2">
        <Badge variant="secondary" className="rounded-md px-2 py-1 text-xs">
          {t("badge")}
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
          {t("description")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {channelSections.map((section) => {
          const Icon = section.icon;

          return (
            <Card key={section.key} className="border-border/70 bg-card/95">
              <CardHeader className="space-y-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{t(`sections.${section.key}.title`)}</CardTitle>
                  <CardDescription className="mt-1 text-sm">
                    {t(`sections.${section.key}.description`)}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Button asChild size="sm">
                  <Link href={section.href}>
                    {t("openSection", {
                      title: t(`sections.${section.key}.title`),
                    })}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
