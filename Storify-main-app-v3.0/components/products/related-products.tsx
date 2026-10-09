import { type Locale } from "@/config/i18n.config";
import { type ModernProduct } from "./modern-product-card";
import { RelatedProductsCarouselLazy as RelatedProductsCarousel } from "./related-products-carousel-lazy";
import { getRelatedProductCards } from "@/lib/products/related-products";

interface RelatedProductsProps {
  productId: string;
  categoryId: string;
  locale: Locale;
  title: string;
  /** Header treatment, forwarded to the carousel. Presentation only. */
  appearance?: "classic" | "electronics";
}

export async function RelatedProducts({
  productId,
  categoryId,
  locale,
  title,
  appearance = "classic",
}: RelatedProductsProps) {
  const products = (await getRelatedProductCards(productId, categoryId)) as ModernProduct[];

  if (products.length === 0) {
    return null;
  }

  return (
    <RelatedProductsCarousel
      products={products}
      locale={locale}
      title={title}
      appearance={appearance}
    />
  );
}
