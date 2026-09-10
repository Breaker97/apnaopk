import { Separator } from "@/components/ui/separator";
import { type Locale } from "@/config/i18n.config";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { BrandsPageClient } from "@/components/store/brands-page-client";
import { getStorefrontBrands } from "@/lib/brands/storefront-brands";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const PAGE_SIZE = 20;

async function getInitialBrands() {
  try {
    return await getStorefrontBrands({ limit: PAGE_SIZE });
  } catch (error) {
    console.error("Failed to load storefront brands:", error);
    return {
      brands: [],
      pagination: {
        page: 1,
        limit: PAGE_SIZE,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
  }
}

export default async function BrandsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { brands, pagination }] = await Promise.all([
    getTranslations({ locale }),
    getInitialBrands(),
  ]);

  return (
    <div className="container mx-auto px-4 py-8 lg:py-12">
      <StoreBreadcrumb
        className="mb-4"
        locale={locale}
        items={[{ label: t("nav.brands") }]}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t("nav.brands")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Browse products by your favorite brands.
        </p>
      </div>

      <Separator className="mb-8" />

      <BrandsPageClient
        locale={locale as Locale}
        initialBrands={brands}
        initialPagination={pagination}
      />
    </div>
  );
}
