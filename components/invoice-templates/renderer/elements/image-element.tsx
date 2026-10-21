import type { CSSProperties } from "react";
import type { ElementRenderProps } from "../types";

const FIT: Record<"contain" | "cover" | "stretch", CSSProperties["objectFit"]> = {
  contain: "contain",
  cover: "cover",
  stretch: "fill",
};

const VERTICAL: Record<"top" | "middle" | "bottom", string> = { top: "top", middle: "center", bottom: "bottom" };

/**
 * The store logo or a media-library image, fitted to the box (§5.7) and
 * placed in it by the element's alignment. A store logo the store does not
 * have prints nothing, or the store's name with `nameWhenNoLogo`.
 */
export function ImageElement({ element, context }: ElementRenderProps<"image">) {
  const { source, src: mediaSrc, fit, nameWhenNoLogo } = element.config;
  const src = source === "storeLogo" ? context.store.logo : mediaSrc;
  if (!src) {
    if (source !== "storeLogo" || !nameWhenNoLogo || !context.store.name) return null;
    return (
      <div className="it-image-name" style={{ overflowWrap: "anywhere" }}>
        {context.store.name}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- printed markup; next/image can't be written into a print iframe
    <img
      className="it-image"
      src={src}
      alt=""
      draggable={false}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: FIT[fit],
        objectPosition: `${element.style.textAlign} ${VERTICAL[element.style.verticalAlign]}`,
      }}
    />
  );
}
