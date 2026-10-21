import { diagnoseContrast } from './contrast';
import type { ColorRole } from '@/lib/storefront/themes/tokens';
export function schemeDiagnostics(scheme: Record<ColorRole,string>) {
  const pairs: [ColorRole,ColorRole,number][] = [
    ...(['text','textMuted','link','saleText'] as ColorRole[]).flatMap(role=>(['background','surface','surfaceAlt'] as ColorRole[]).map(bg=>[role,bg,4.5] as [ColorRole,ColorRole,number])),
    ['onPrimary','primary',4.5],['onSecondary','secondary',4.5],['onAccent','accent',4.5],
    ['onAccentSurface','accentSurface',4.5],['onHover','hoverSurface',4.5],['onSelected','selectedSurface',4.5],
    ['onSale','sale',4.5],['onSaleSurface','saleSurface',4.5],
    ...(['focusRing','fieldBorder','rating'] as ColorRole[]).flatMap(role=>(['background','surface','surfaceAlt'] as ColorRole[]).map(bg=>[role,bg,3] as [ColorRole,ColorRole,number])),
    // A fill that all but vanishes into the page (a dark button on a dark
    // page). Its label stays readable, so the bar is "can it be seen at all",
    // not 3:1 — a light cyan or amber button on white is a fine design.
    ...(['primary','secondary','accent','sale'] as ColorRole[]).flatMap(role=>(['background','surface'] as ColorRole[]).map(bg=>[role,bg,1.5] as [ColorRole,ColorRole,number])),
  ];
  return pairs.map(([role,against,minimum])=>({role,against,...diagnoseContrast(scheme[role],scheme[against],minimum)}));
}
