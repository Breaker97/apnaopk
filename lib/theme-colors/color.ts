/** Pure color parsing. CSS alpha survives parsing; identity colors use opaqueHex. */
export type Rgba = { r: number; g: number; b: number; a: number };
export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const hex = raw.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return {r: parseInt(h.slice(0,2),16), g:parseInt(h.slice(2,4),16), b:parseInt(h.slice(4,6),16), a:h.length === 8 ? parseInt(h.slice(6),16)/255 : 1};
  }
  const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(\d*\.?\d+)(%)?\s*)?\)$/i);
  if (!rgb || rgb.slice(1,4).some(c => Number(c) > 255)) return null;
  const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
  if (a < 0 || a > 1) return null;
  return {r:Number(rgb[1]),g:Number(rgb[2]),b:Number(rgb[3]),a};
}
export function toHex(c: Rgba): string {
  return '#' + [c.r,c.g,c.b].map(v => Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
}
export function opaqueHex(value: unknown): string | null { const c = parseColor(value); return c ? toHex(c) : null; }
export function composite(value: string, ground: string): string {
  const c=parseColor(value), bg=parseColor(ground);
  if (!c || !bg) return ground;
  return toHex({r:c.r*c.a+bg.r*(1-c.a),g:c.g*c.a+bg.g*(1-c.a),b:c.b*c.a+bg.b*(1-c.a),a:1});
}
export function mix(a: string,b: string,amount: number): string {
  const x=parseColor(a),y=parseColor(b); if (!x || !y) return a;
  return toHex({r:x.r+(y.r-x.r)*amount,g:x.g+(y.g-x.g)*amount,b:x.b+(y.b-x.b)*amount,a:1});
}

/** WCAG relative luminance, 0 (black) to 1 (white); null when unreadable. */
export function luminance(value: unknown): number | null {
  const c = parseColor(value);
  if (!c) return null;
  const [r, g, b] = [c.r, c.g, c.b].map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export type Hsl = { h: number; s: number; l: number };

/** Hue in degrees, saturation and lightness 0–1. */
export function toHsl(value: unknown): Hsl | null {
  const c = parseColor(value);
  if (!c) return null;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function fromHsl({ h, s, l }: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return toHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: 1 });
}
