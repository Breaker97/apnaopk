import { px } from "../styles";
import type { ElementRenderProps } from "../types";

/** A rule across the box: thickness, style and colour from `style.border*` (P1 seam). */
export function LineElement({ element }: ElementRenderProps<"line">) {
  const { borderWidthPx, borderStyle, borderColor } = element.style;
  const stroke = `${px(Math.max(0.5, borderWidthPx))} ${borderStyle === "none" ? "solid" : borderStyle} ${borderColor}`;
  if (element.config.orientation === "vertical") {
    return <div className="it-line" style={{ width: 0, height: "100%", borderLeft: stroke, margin: "0 auto" }} />;
  }
  return <div className="it-line" style={{ height: 0, width: "100%", borderTop: stroke, margin: "auto 0" }} />;
}

/** A box is its own background, border and radius; the element box draws them. */
export function BoxElement(_props: ElementRenderProps<"box">) {
  return null;
}
