import { KEY_COLOR_ROLES, type KeyColorRole, type ThemeTokens } from './tokens';
import type { BrandColors } from './compile';
import { parseColor } from '@/lib/theme-colors/color';
export const THEME_PREVIEW_MESSAGE = 'storify:theme-preview';
export const THEME_PREVIEW_READY_MESSAGE = 'storify:theme-preview-ready';
export const THEME_PREVIEW_PROTOCOL = 2;
/** The key colours as the theme paints them (light) — what the dashboards take. */
export interface PreviewKeyColors {
  primary: string;
  secondary: string;
  accent: string;
}
/**
 * What a framed dashboard page announces instead of a theme id: it takes the
 * key colours only (its sidebar and buttons follow the theme), whatever theme
 * is being edited.
 */
export const THEME_PREVIEW_DASHBOARD_SURFACE = 'dashboard';
export interface ThemePreviewMessage {
  type: typeof THEME_PREVIEW_MESSAGE;
  protocolVersion: 2;
  themeId: string;
  sequence: number;
  tokens: ThemeTokens;
  brand: BrandColors;
  previewMode: 'light' | 'dark';
  /** A key colour the frame marks wherever it paints; absent or null marks none. */
  highlight?: KeyColorRole | null;
  /** The unsaved key colours, for a framed dashboard page (see `surface`). */
  keyColors?: PreviewKeyColors;
}
export function isThemePreviewMessage(data: unknown): data is ThemePreviewMessage {
  if (!data || typeof data !== 'object') return false;
  const d=data as Partial<ThemePreviewMessage>;
  return d.type === THEME_PREVIEW_MESSAGE && d.protocolVersion === 2 && typeof d.themeId === 'string' && Number.isSafeInteger(d.sequence) && Number(d.sequence)>=0 &&
    !!d.tokens && typeof d.tokens === 'object' && (d.tokens.colors?.schemaVersion === 3 || d.tokens.colors?.schemaVersion === 4) &&
    !!d.brand && ['primary','secondary','accent'].every(k=>!!parseColor(d.brand![k as keyof BrandColors])) &&
    (d.brand.skeleton === undefined || d.brand.skeleton === '' || !!parseColor(d.brand.skeleton)) &&
    (d.previewMode === 'light' || d.previewMode === 'dark') &&
    (d.highlight === undefined || d.highlight === null || (KEY_COLOR_ROLES as readonly string[]).includes(d.highlight)) &&
    (d.keyColors === undefined || (!!d.keyColors && typeof d.keyColors === 'object' && ['primary','secondary','accent'].every(k=>!!parseColor(d.keyColors![k as keyof PreviewKeyColors]))));
}
