"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import {
  Home,
  Search,
  ShoppingBag,
  Tag,
  Heart,
  ChevronRight,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NotFoundIllustration } from "@/components/errors/not-found-illustration";
import { BackButton } from "@/components/errors/back-button";

const popularLinks = [
  {
    href: "/products",
    icon: ShoppingBag,
    labelKey: "navigation.allProducts",
    defaultLabel: "All Products",
    description: "Browse our full catalog",
  },
  {
    href: "/products?featured=true",
    icon: Sparkles,
    labelKey: "navigation.featured",
    defaultLabel: "Featured",
    description: "Our top picks for you",
  },
  {
    href: "/products?sale=true",
    icon: Tag,
    labelKey: "navigation.onSale",
    defaultLabel: "On Sale",
    description: "Great deals and discounts",
  },
];

export default function StoreNotFound() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  const [query, setQuery] = React.useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/${locale}/products?search=${encodeURIComponent(q)}`);
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-8">
        {/* Illustration */}
        <div className="flex justify-center">
          <NotFoundIllustration variant="store" className="w-72 h-52" />
        </div>

        {/* Content */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t("errors.pageNotFound")}
          </h1>
          <p className="text-muted-foreground text-base max-w-md mx-auto">
            {t("errors.storePageNotFoundDescription")}
          </p>
        </div>

        {/* Search */}
        <Card className="border-2 border-dashed">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
              <span>{t("common.searchForProducts")}</span>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="search"
                aria-label={t("common.search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("common.searchPlaceholder")}
                className="flex-1"
              />
              <Button type="submit" className="w-full sm:w-auto">
                <Search className="size-4" aria-hidden="true" />
                {t("common.search")}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <BackButton
            label={t("common.goBack")}
            className="w-full sm:w-auto"
          />
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/${locale}`}>
              <Home className="size-4" aria-hidden="true" />
              {t("common.backToHome")}
            </Link>
          </Button>
        </div>

        {/* Popular Links */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground text-center">
            {t("common.popularPages")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {popularLinks.map((link) => (
              <Link
                key={link.href}
                href={`/${locale}${link.href}`}
                className="group"
              >
                <Card className="h-full transition-all duration-200 hover:bg-accent hover:border-accent-foreground/20 group-focus-visible:ring-2 group-focus-visible:ring-ring">
                  <CardContent className="p-3 flex items-center gap-3">
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

        {/* CTA Banner */}
        <Card className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-center sm:text-left">
              <div className="shrink-0 size-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Heart className="size-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {t("store.discoverNewArrivals")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("store.newArrivalsDescription")}
                </p>
              </div>
            </div>
            <Button asChild variant="secondary" size="sm" className="shrink-0">
              <Link href={`/${locale}/products?sort=newest`}>
                {t("common.shopNow")}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Help text */}
        <p className="text-center text-xs text-muted-foreground">
          {t("errors.stillNeedHelp")}
        </p>
      </div>
    </div>
  );
}
