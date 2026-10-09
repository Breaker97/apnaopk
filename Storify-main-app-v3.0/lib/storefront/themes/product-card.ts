import {
  getDefaultProductCardConfig,
  normalizeProductCardConfig,
  PRODUCT_CARD_TEMPLATES,
  type ProductCardConfig,
} from "@/lib/products/product-card-config";
import { getActiveThemeManifest } from "@/lib/storefront/themes/registry";

/**
 * The stored product card, or — when the merchant never saved one — the
 * active theme's own template. Activation seeds the template into
 * `settings.productCard` (see `applyThemeStarter`), but a store that
 * activated its theme before the card became configurable has nothing
 * stored and must still render the card its theme was designed around.
 */
export function resolveStoredProductCardConfig(
  raw: unknown,
  activeTheme: unknown,
): ProductCardConfig {
  const stored =
    typeof raw === "object" && raw !== null && Object.keys(raw).length > 0;
  if (stored) return normalizeProductCardConfig(raw);
  const template = getActiveThemeManifest(activeTheme).productCard;
  return template
    ? normalizeProductCardConfig(PRODUCT_CARD_TEMPLATES[template])
    : getDefaultProductCardConfig();
}
