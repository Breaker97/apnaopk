"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PackageCheck } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { truncateByWords } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import type { LatestProduct } from "@/lib/admin/dashboard-types";

export function DashboardLatestProducts({
  products,
}: {
  products: LatestProduct[];
}) {
  const t = useTranslations();
  const intlLocale = useLocale();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale || intlLocale || "en";
  const { formatPrice } = useCurrency();

  return (
    <section className="rounded-sm border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {t("admin.dashboardPage.latestProducts", {
          defaultMessage: "Latest Products",
        })}
      </h2>

      {products.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {t("admin.dashboardPage.noLatestProducts", {
            defaultMessage: "No latest products found.",
          })}
        </p>
      ) : (
        <div className="mt-5 divide-y divide-border">
          {products.map((product) => {
            const displayName = truncateByWords(product.name, 9);

            return (
              <Link
                key={product._id}
                href={`/${locale}/admin/products/${product._id}/edit`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors first:pt-0 last:pb-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                  {product.image ? (
                    <AppImage
                      src={product.image}
                      alt={product.name}
                      fill
                      className="object-cover"
                      sizes="40px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <PackageCheck className="size-4" />
                    </div>
                  )}
                </div>
                <p
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                  title={displayName !== product.name ? product.name : undefined}
                >
                  {displayName}
                </p>
                <span className="shrink-0 text-sm font-medium text-foreground">
                  {formatPrice(product.price)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
