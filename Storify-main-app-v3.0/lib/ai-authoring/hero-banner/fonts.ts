import path from "node:path";

import { openSync } from "fontkit";

type HeroFont = { name: string; regular: string; bold: string };

const root = process.cwd();
const fonts: HeroFont[] = [
  {
    name: "Noto Sans",
    regular: path.join(
      root,
      "node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2",
    ),
    bold: path.join(
      root,
      "node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2",
    ),
  },
  {
    name: "Noto Sans Bengali",
    regular: path.join(
      root,
      "node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2",
    ),
    bold: path.join(
      root,
      "node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff2",
    ),
  },
];

function covers(pathname: string, value: string): boolean {
  const font = openSync(pathname);
  if (!("hasGlyphForCodePoint" in font)) return false;
  return (
    Array.from(value).every(
      (char) =>
        /\s/.test(char) || font.hasGlyphForCodePoint(char.codePointAt(0)!),
    )
  );
}

export function resolveHeroBannerFont(value: string): HeroFont | null {
  return (
    fonts.find(
      (font) => covers(font.regular, value) && covers(font.bold, value),
    ) || null
  );
}
