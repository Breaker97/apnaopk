"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type NavItem = { label: string; href: string };

function useAdminNavItems(t: (key: string) => string): NavItem[] {
  const items: NavItem[] = [
    { label: t("admin.sidebar.dashboard"), href: "/admin/dashboard" },
    { label: t("admin.sidebar.orders"), href: "/admin/orders" },
    { label: t("admin.sidebar.products"), href: "/admin/products" },
    { label: t("admin.sidebar.collections"), href: "/admin/collections" },
    { label: t("admin.sidebar.inventory"), href: "/admin/inventory" },
    // { label: t("admin.sidebar.purchaseOrders"), href: "/admin/purchase-orders" },
    { label: t("admin.sidebar.transfers"), href: "/admin/transfers" },
    // { label: t("admin.sidebar.giftCards"), href: "/admin/gift-cards" },
    { label: t("admin.sidebar.customers"), href: "/admin/users" },
    { label: t("admin.sidebar.marketing"), href: "/admin/marketing" },
    { label: t("admin.sidebar.discounts"), href: "/admin/discounts" },
    { label: t("admin.sidebar.content"), href: "/admin/content" },
    { label: t("admin.sidebar.markets"), href: "/admin/markets" },
    { label: t("admin.sidebar.analytics"), href: "/admin/analytics" },
    { label: t("admin.sidebar.searchInsights"), href: "/admin/analytics/search" },
    { label: t("admin.sidebar.onlineStore"), href: "/admin/online-store" },
    { label: t("admin.sidebar.themes"), href: "/admin/online-store/theme" },
    {
      label: t("admin.themeSettings.tabs.branding"),
      href: "/admin/online-store/theme?tab=branding",
    },
    { label: t("admin.sidebar.customize"), href: "/admin/online-store/customize" },
    { label: t("admin.sidebar.checkout"), href: "/admin/online-store/checkout" },
    {
      label: t("admin.sidebar.productCard"),
      href: "/admin/online-store/product-card",
    },
    { label: t("admin.sidebar.pages"), href: "/admin/online-store/pages" },
    {
      label: t("footer.termsOfService"),
      href: "/admin/online-store/pages/terms-of-service",
    },
    {
      label: t("auth.privacyPolicy"),
      href: "/admin/online-store/pages/privacy-policy",
    },
    {
      label: t("footer.cookiePolicy"),
      href: "/admin/online-store/pages/cookie-policy",
    },
    {
      label: t("footer.accessibility"),
      href: "/admin/online-store/pages/accessibility",
    },
    { label: t("nav.faq"), href: "/admin/online-store/pages/faq" },
    { label: t("admin.sidebar.addPage"), href: "/admin/online-store/pages/new" },
    { label: t("admin.settings.title"), href: "/admin/settings" },
  ];
  return items;
}

export function SearchModal() {
  const t = useTranslations();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const items = useAdminNavItems(t);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered =
    query.trim().length === 0
      ? items
      : items.filter(
          (i) =>
            i.label.toLowerCase().includes(query.toLowerCase()) ||
            i.href.toLowerCase().includes(query.toLowerCase()),
        );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 left-1/2 top-16 -translate-x-1/2 rounded-2xl bg-popover shadow-xl border border-border/60 w-[min(720px,90vw)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("common.search")}
          </DialogPrimitive.Title>
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={t("common.searchPlaceholder", {
                default: "Search...",
              })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 border-0 shadow-none focus-visible:ring-0"
            />
            <span className="ml-auto text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted">
              Esc
            </span>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            {filtered.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-4 py-3 border-b hover:bg-muted/50"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{i.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {i.href}
                  </span>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-md bg-muted text-muted-foreground">
                  {t("common.overview")}
                </span>
              </Link>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
      <DialogPrimitive.Trigger asChild>
        <button
          className="hidden md:flex items-center gap-2 h-9 px-3 rounded-2xl border bg-background hover:bg-muted/50 transition-colors"
          onClick={() => setOpen(true)}
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
            ⌘K
          </span>
        </button>
      </DialogPrimitive.Trigger>
    </DialogPrimitive.Root>
  );
}
