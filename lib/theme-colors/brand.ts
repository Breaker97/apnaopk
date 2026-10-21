export const BRAND_SAVE_KEYS = ['primaryColor','secondaryColor','accentColor','skeletonColor','presetColor','customPresets'] as const;
/**
 * What the brand IS, for "is anything unsaved": colours compared as colours
 * (#2065D1 and #2065d1 are one), and the preset marker left out — it only
 * remembers which chip was clicked, so going back to the saved colours by
 * another route is not a change.
 */
export function brandFingerprint(appearance: unknown, toHex: (value: string) => string | null): string {
  const brand = pickBrand(appearance);
  const color = (value: unknown) => (typeof value === 'string' ? toHex(value) ?? value : value);
  const presets = Array.isArray(brand.customPresets)
    ? brand.customPresets.map(p => p && typeof p === 'object' ? {...p as Record<string,unknown>, primaryColor: color((p as Record<string,unknown>).primaryColor), accentColor: color((p as Record<string,unknown>).accentColor)} : p)
    : brand.customPresets;
  return JSON.stringify({
    primaryColor: color(brand.primaryColor),
    secondaryColor: color(brand.secondaryColor),
    accentColor: color(brand.accentColor),
    skeletonColor: color(brand.skeletonColor),
    customPresets: presets,
  });
}
export function pickBrand(appearance: unknown): Record<string,unknown> {
  const source = appearance && typeof appearance === 'object' ? appearance as Record<string,unknown> : {};
  return Object.fromEntries(BRAND_SAVE_KEYS.map(k=>[k,source[k] === undefined ? undefined : JSON.parse(JSON.stringify(source[k]))]));
}
