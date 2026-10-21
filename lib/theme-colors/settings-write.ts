import { ConflictError, ValidationError } from '@/lib/api/errors';
import { sectionVersion } from '@/lib/settings/section-versions';
import { BRAND_SAVE_KEYS, pickBrand } from './brand';
import { opaqueHex } from './color';
import { BRAND_COLOR_REFS, COLOR_ROLES } from '@/lib/storefront/themes/tokens';
import { isRecord } from '@/lib/utils';
export function normalizeBrandPatch(raw: unknown): Record<string,unknown> {
  if (!isRecord(raw)) throw new ValidationError('Brand colors must be an object');
  if (Object.keys(raw).some(k=>!(BRAND_SAVE_KEYS as readonly string[]).includes(k))) throw new ValidationError('Unknown brand color field');
  const out={...raw};
  for (const k of ['primaryColor','secondaryColor','accentColor','skeletonColor']) if (k in out) {
    if (out[k] === '' && k === 'skeletonColor') continue;
    const color=opaqueHex(out[k]);
    if (!color) throw new ValidationError({[k]:['Enter a valid hex or RGB color']});
    out[k]=color;
  }
  if ('presetColor' in out && !['default','cyan','purple','blue','orange','red'].includes(String(out.presetColor))) throw new ValidationError('Invalid color preset');
  if ('customPresets' in out) {
    if (!Array.isArray(out.customPresets) || out.customPresets.length>50) throw new ValidationError('Invalid custom presets');
    out.customPresets=out.customPresets.map(p=>{
      if (!isRecord(p) || typeof p.name !== 'string' || !p.name.trim() || typeof p.id !== 'string') throw new ValidationError('Invalid custom preset');
      const result={...p};
      for (const k of ['primaryColor','accentColor']) { const color=opaqueHex(p[k]);if (!color) throw new ValidationError('Invalid preset color');result[k]=color; }
      // The retired brand secondary: older presets still carry one, new ones do not.
      if (p.secondaryColor !== undefined) { const color=opaqueHex(p.secondaryColor);if (!color) throw new ValidationError('Invalid preset color');result.secondaryColor=color; }
      return result;
    });
  }
  return out;
}
export function validateThemeColorInput(raw: unknown) {
  if (!isRecord(raw)) throw new ValidationError('Theme values must be an object');
  for (const key of ['backgroundColor','backgroundColorDark','cardColor','accentColor']) if (key in raw && raw[key] !== '' && !opaqueHex(raw[key])) throw new ValidationError('Invalid legacy theme color');
  if (raw.colors === undefined) return;
  if (!isRecord(raw.colors)) throw new ValidationError('Theme colors must be an object');
  for (const mode of ['light','dark']) if (raw.colors[mode] !== undefined && !isRecord(raw.colors[mode])) throw new ValidationError('A color scheme must be an object');
  if (raw.colors.schemaVersion !== undefined && (!Number.isSafeInteger(raw.colors.schemaVersion) || Number(raw.colors.schemaVersion)<1 || Number(raw.colors.schemaVersion)>4)) throw new ValidationError('Unsupported theme color schema version');
  // Schema 4: the theme owns its key colours, so a brand reference is not a colour there.
  const brandRefs=raw.colors.schemaVersion === 4 ? [] : BRAND_COLOR_REFS as readonly string[];
  for (const mode of ['light','dark']) if (isRecord(raw.colors[mode])) {
    const scheme=raw.colors[mode];
    for (const role of COLOR_ROLES) if (role in scheme && scheme[role] !== '' && !brandRefs.includes(scheme[role] as string) && !opaqueHex(scheme[role])) throw new ValidationError({[`colors.${mode}.${role}`]:[brandRefs.length ? 'Enter a valid color or brand reference' : 'Enter a valid color']});
  }
}
export function themeScopeVersions(rawTheme: unknown,appearance: unknown) {
  return {themeValues:sectionVersion(rawTheme),brandColors:sectionVersion(pickBrand(appearance))};
}
export function capturePath(raw: unknown,path: string): unknown {
  let value=raw;
  for (const key of path.split('.')) {if (!value || typeof value !== 'object' || !(key in value)) return {$exists:false};value=(value as Record<string,unknown>)[key];}
  return value === undefined ? {$exists:false} : {$eq:value};
}
export function brandWriteGuard(raw: unknown) {
  return Object.fromEntries(BRAND_SAVE_KEYS.map(k=>[`appearance.${k}`,capturePath(raw,`appearance.${k}`)]));
}
export function assertScope(current: string,expected: string | undefined) {
  if (expected !== undefined && current !== expected) throw new ConflictError('These colors changed since you opened the editor. Reload the saved version; your draft has been kept.');
}
