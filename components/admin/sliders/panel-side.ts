/**
 * Which side of the artboard a property panel opens on. Beside the board
 * when there is room for the panel there — the phone boards are narrow, so
 * a panel fits next to them like a properties panel — and under it
 * otherwise, which is where the landscape board (as wide as its host)
 * always sends it. Never over the board: that is the one place the copy
 * being styled is. Measured on open, in the click handler, never in render.
 */
export type PanelSide = "right" | "left" | "bottom";

export function panelSide(anchor: HTMLElement, panelWidth: number): PanelSide {
  const rect = anchor.getBoundingClientRect();
  // The panel, its offset from the board, and the window's own padding.
  const need = panelWidth + 24;
  if (window.innerWidth - rect.right >= need) return "right";
  if (rect.left >= need) return "left";
  return "bottom";
}
