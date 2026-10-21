import { composite, parseColor } from './color';
export function contrastRatio(a: unknown,b: unknown,ground?: string): number {
  let x=parseColor(a),y=parseColor(b); if (!x || !y) return 1;
  if (y.a < 1) { if (!ground) return 1; y=parseColor(composite(String(b),ground))!; }
  if (x.a < 1) x=parseColor(composite(String(a),composite(String(b),ground ?? String(b))))!;
  const lum=(c: typeof x) => { const p=[c!.r,c!.g,c!.b].map(v => {const n=v/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});return p[0]*.2126+p[1]*.7152+p[2]*.0722; };
  const l1=lum(x),l2=lum(y);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
}
export function readableForegroundColor(fill: string): string {
  const choices=['#ffffff','#1a1a1a'];
  choices.sort((a,b)=>contrastRatio(b,fill)-contrastRatio(a,fill));
  return contrastRatio(choices[0],fill)>=4.5 ? choices[0] : '#000000';
}
export function textThreshold(size=14,weight=400): number { return size>=24 || (size>=18.667 && weight>=700) ? 3 : 4.5; }
export function diagnoseContrast(foreground: string,background: string,minimum=4.5) {
  const known=!!parseColor(foreground)&&!!parseColor(background)&&parseColor(background)!.a===1;
  const ratio=known?contrastRatio(foreground,background):null;
  return {ratio,minimum,passes:ratio===null?null:ratio>=minimum};
}
