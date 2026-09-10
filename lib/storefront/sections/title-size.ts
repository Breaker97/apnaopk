import type { CSSProperties } from "react";
import {
  SECTION_TITLE_SIZES,
  TITLE_SIZE_FIELD_KEY,
  type SectionTitleSize,
} from "./types";

/**
 * A section's title size, as CSS custom properties.
 *
 * Every section paints its heading differently — a themed two-tone split, a
 * plain shelf label, a row header with a "view all" beside it — so the size
 * cannot be a shared component without rewriting all of them. It travels as
 * two inherited variables instead: each heading keeps its own markup and
 * reads the variable, falling back to exactly the size it has today when a
 * section carries no choice.
 *
 * The steps match the standalone Heading block, so "medium" means the same
 * thing wherever a merchant meets it. Each heading spells its own size out
 * as the variable's fallback, which is why an unset section is untouched.
 */
const TITLE_SIZE_PX: Record<SectionTitleSize, { base: string; lg: string }> = {
  small: { base: "1rem", lg: "1.125rem" },
  medium: { base: "1.375rem", lg: "1.75rem" },
  large: { base: "1.75rem", lg: "2.5rem" },
};

function isSectionTitleSize(value: unknown): value is SectionTitleSize {
  return (
    typeof value === "string" &&
    (SECTION_TITLE_SIZES as readonly string[]).includes(value)
  );
}

/**
 * The variables for one instance, or nothing when it carries no choice —
 * an unset section inherits whatever surrounds it, which is how a heading
 * keeps the size it has always had.
 */
export function sectionTitleVars(
  settings: Record<string, unknown>,
): CSSProperties | undefined {
  const size = settings[TITLE_SIZE_FIELD_KEY];
  if (!isSectionTitleSize(size)) return undefined;
  const step = TITLE_SIZE_PX[size];
  return {
    "--sec-title": step.base,
    "--sec-title-lg": step.lg,
  } as CSSProperties;
}
