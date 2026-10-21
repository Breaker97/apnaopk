import "server-only";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

/**
 * The active store theme's card radius in pixels: the corners every
 * Campaign Banner popup wears on the shop. The editor's preview draws with it
 * so a popup looks the same there as it will on the store. Null when the
 * theme cannot be read; the preview then falls back to the dashboard's own.
 */
export async function getStorefrontCardRadius(): Promise<number | null> {
  try {
    const { theme } = await getStorefrontSettings();
    const radius = theme.tokens.shape.cardRadius;
    return Number.isFinite(radius) ? radius : null;
  } catch {
    return null;
  }
}
