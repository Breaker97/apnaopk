import type { CSSProperties } from "react";
import { opaqueHex } from "./color";
import { readableForegroundColor } from "./contrast";

/**
 * The "apparent" dashboard sidebar: painted in the brand primary, with the
 * ink that reads on it. It used to write white on whatever the primary was,
 * so a cyan or orange brand left the whole navigation unreadable; the
 * hover/active wash follows the ink (a white wash on a dark brand, a dark
 * one on a light brand).
 */
export function apparentSidebarStyle(color: string | undefined): CSSProperties {
  const fill = opaqueHex(color) ?? "#2065d1";
  const ink = readableForegroundColor(fill);
  const wash = ink === "#ffffff" ? "rgb(255 255 255 / 0.2)" : "rgb(0 0 0 / 0.08)";
  return {
    "--sidebar": fill,
    "--color-sidebar": fill,
    "--sidebar-foreground": ink,
    "--color-sidebar-foreground": ink,
    "--sidebar-accent": wash,
    "--color-sidebar-accent": wash,
    "--sidebar-accent-foreground": ink,
    "--color-sidebar-accent-foreground": ink,
  } as CSSProperties;
}

/** Whether the apparent sidebar reads as a dark surface (white ink, light logo art). */
export function apparentSidebarIsDark(color: string | undefined): boolean {
  return readableForegroundColor(opaqueHex(color) ?? "#2065d1") === "#ffffff";
}
