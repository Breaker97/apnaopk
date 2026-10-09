import type { CSSProperties } from "react";
import type { SectionDefinition, SectionRenderProps } from "../types";

/**
 * A pure spacer: fixed vertical breathing room between two neighbouring
 * blocks, for the places where sections sit tighter than the design wants.
 * It renders the same run on the live store and in preview —
 * the builder's block list is what names it for the merchant.
 */
const Render = ({ settings }: SectionRenderProps) => (
  // Pixels are authored against the desktop page; a phone's shorter
  // sections take 60% of them, or a 100px gap reads as a missing section.
  <div
    aria-hidden
    className="h-[calc(var(--gap-h)*0.6)] md:h-(--gap-h)"
    style={{ "--gap-h": `${settings.height as number}px` } as CSSProperties}
  />
);

export const gap: SectionDefinition = {
  type: "gap",
  version: 1,
  category: "content",
  fields: [
    {
      key: "height",
      type: "number",
      hint: "Vertical space in pixels.",
      default: 48,
      min: 4,
      max: 400,
    },
  ],
  Render,
};
