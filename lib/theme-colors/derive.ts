import { fromHsl, luminance, mix, toHsl } from './color';
import { contrastRatio, readableForegroundColor } from './contrast';

/**
 * A FILL that stays visible on the given surfaces: the colour itself when it
 * already stands out by `minimum`, else the nearest lighter (on dark
 * surfaces) or darker (on light ones) tone of the SAME hue. Mixing toward
 * white would wash a navy button out to grey; moving lightness keeps it the
 * brand's navy, just one a shopper can see on a dark page.
 */
export function visibleTone(source: string, surfaces: string[], minimum = 3): string {
  if (surfaces.every((bg) => contrastRatio(source, bg) >= minimum)) return source;
  const hsl = toHsl(source);
  if (!hsl) return source;
  const grounds = surfaces.map((bg) => luminance(bg) ?? 0);
  const lighten = grounds.reduce((sum, value) => sum + value, 0) / grounds.length < 0.5;
  for (let step = 1; step <= 100; step++) {
    const l = lighten ? hsl.l + step / 100 : hsl.l - step / 100;
    if (l < 0 || l > 1) break;
    const tone = fromHsl({ ...hsl, l });
    if (surfaces.every((bg) => contrastRatio(tone, bg) >= minimum)) return tone;
  }
  return readableTone(source, surfaces, minimum);
}
/** Closest quantized tone toward either endpoint that satisfies every surface, or null. */
function findTone(source: string,surfaces: string[],minimum: number): string | null {
  if (surfaces.every(bg=>contrastRatio(source,bg)>=minimum)) return source;
  for (let step=1;step<=1000;step++) for (const end of ['#000000','#ffffff']) {
    const tone=mix(source,end,step/1000);
    if (surfaces.every(bg=>contrastRatio(tone,bg)>=minimum)) return tone;
  }
  return null;
}
/** Closest quantized tone toward either endpoint that satisfies every surface. */
export function readableTone(source: string,surfaces: string[],minimum=4.5): string {
  return findTone(source,surfaces,minimum) ?? readableForegroundColor(surfaces[0]);
}
/**
 * The closest tone that reads on every surface; when none can (a band far from
 * the page, say slate on white), the closest that reads on the MAIN ones — the
 * page and its cards. One off-family band then cannot drag every link, sale
 * price and caption to plain black or white; the band's own row warns instead.
 */
export function readableToneOn(source: string,main: string[],extra: string[],minimum=4.5): string {
  return findTone(source,[...main,...extra],minimum) ?? findTone(source,main,minimum) ?? readableForegroundColor(main[0]);
}
export function interactionColors(surface: string,text: string,primary: string,accent: string,sale: string,dark: boolean) {
  const hoverSurface=mix(surface,readableForegroundColor(surface),.06);
  const selectedSurface=mix(surface,primary,dark?.18:.10);
  const accentSurface=mix(surface,accent,dark?.18:.12);
  const saleSurface=mix(surface,sale,dark?.18:.12);
  return {hoverSurface,onHover:readableTone(text,[hoverSurface]),selectedSurface,onSelected:readableTone(text,[selectedSurface]),onAccent:readableForegroundColor(accent),accentSurface,onAccentSurface:readableForegroundColor(accentSurface),onSale:readableForegroundColor(sale),saleSurface,onSaleSurface:readableForegroundColor(saleSurface)};
}

export function actionColors(fill: string,foreground: string) {
  const endpoint=foreground === "#ffffff" ? "#000000" : "#ffffff";
  const state=(amount:number) => {const candidate=mix(fill,endpoint,amount);return contrastRatio(foreground,candidate)>=4.5 ? candidate : fill;};
  return {hover:state(.06),pressed:state(.12)};
}
