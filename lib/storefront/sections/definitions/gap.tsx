import type { SectionDefinition, SectionRenderProps } from "../types";

/**
 * A pure spacer: fixed vertical breathing room between two neighbouring
 * blocks, for the places where sections sit tighter than the design wants.
 * It renders the same empty run of pixels on the live store and in preview —
 * the builder's block list is what names it for the merchant.
 */
const Render = ({ settings }: SectionRenderProps) => (
  <div aria-hidden style={{ height: `${settings.height as number}px` }} />
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
