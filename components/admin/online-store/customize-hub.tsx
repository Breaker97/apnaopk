"use client";

import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  CreditCard,
  FolderTree,
  Home,
  LayoutGrid,
  Layers,
  Package,
  ShoppingCart,
  SquareMousePointer,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { createTSafe } from "@/components/admin/online-store/t-safe";

/**
 * The Customize landing: one card per customizable storefront page, each
 * opening its editor — the section builder for the templates, the dedicated
 * editors for the product card and checkout. The builder's own page switcher
 * still moves between them once inside.
 *
 * Each card's picture is a static file at `public/images/customize/<key>.webp`;
 * should one be missing, the card shows the page's icon instead.
 */
export function CustomizeHub() {
  const tSafe = createTSafe(useTranslations());

  const builder = (page: string) =>
    `/admin/online-store/customize?page=${encodeURIComponent(page)}`;

  const surfaces = [
    {
      key: "home",
      href: builder("home"),
      icon: Home,
      title: tSafe("admin.storeBuilder.switcher.home", "Home page"),
    },
    {
      key: "product",
      href: builder("template:product"),
      icon: Package,
      title: tSafe("admin.storeBuilder.switcher.product", "Product details"),
    },
    {
      key: "products",
      href: builder("template:products"),
      icon: LayoutGrid,
      title: tSafe("admin.storeBuilder.switcher.products", "Product listing"),
    },
    {
      key: "category",
      href: builder("template:category"),
      icon: FolderTree,
      title: tSafe("admin.storeBuilder.switcher.category", "Category page"),
    },
    {
      key: "collection",
      href: builder("template:collection"),
      icon: Layers,
      title: tSafe("admin.storeBuilder.switcher.collection", "Collection page"),
    },
    {
      key: "cart",
      href: builder("template:cart"),
      icon: ShoppingCart,
      title: tSafe("admin.storeBuilder.switcher.cart", "Cart"),
    },
    {
      key: "product-card",
      href: "/admin/online-store/product-card",
      icon: SquareMousePointer,
      title: tSafe("admin.storeBuilder.switcher.productCard", "Product card"),
    },
    {
      key: "checkout",
      href: "/admin/online-store/checkout",
      icon: CreditCard,
      title: tSafe("admin.storeBuilder.switcher.checkout", "Checkout"),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {tSafe("admin.customizeHub.title", "Customize")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {tSafe(
            "admin.customizeHub.description",
            "Choose a storefront page to customize.",
          )}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {surfaces.map((surface) => (
          <Link
            key={surface.key}
            href={surface.href}
            className="group flex h-full flex-col gap-4 rounded-[12px] border border-transparent bg-muted p-3 transition-colors hover:bg-card focus-visible:border-primary focus-visible:outline-none"
          >
            {/* The page's picture, edge to edge in a frame of the
                screenshots' own shape (380×281) with the card's corner
                radius. A taller shot loses a few rows at the bottom, never
                the page header. Served as the file itself — these are a few
                small admin-only screenshots, and the optimizer's second
                lossy pass blurs the small type in them. */}
            <div className="relative aspect-[380/281] w-full overflow-hidden rounded-[8px] border border-border bg-card">
              <AppImage
                src={`/images/customize/${surface.key}.webp`}
                alt=""
                fill
                unoptimized
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover object-top"
                fallback={
                  <span className="grid h-full w-full place-items-center bg-primary/5 text-primary">
                    <surface.icon className="h-10 w-10" aria-hidden />
                  </span>
                }
              />
            </div>
            <span className="flex items-center justify-center gap-2 pb-2 text-lg font-semibold text-foreground/80 group-hover:text-foreground">
              {surface.title}
              <ArrowUpRight
                className="h-5 w-5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100"
                aria-hidden
              />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
