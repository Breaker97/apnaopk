import { cn } from "@/lib/utils";
import { lt } from "../localized";
import type {
  LocalizedText,
  SectionDefinition,
  SectionInstance,
  SectionRenderProps,
} from "../types";

/**
 * A standalone section heading — the design's "Top Collections" / "Find
 * Products" titles that sit ABOVE a run of sections rather than inside one.
 * Content sections keep their own titles; this exists for the surfaces
 * where one heading spans several sections.
 *
 * Two texts, not one: the design's headings read as a light lead-in plus an
 * emphasised tail ("Find **Products**"). Splitting them into their own
 * fields is what lets a merchant choose where the break falls — deriving it
 * from the last space, as this section used to, gets "Cameras & Smart
 * **Home**" wrong every time.
 */

const HEADING_ALIGNMENTS = ["left", "center", "right"] as const;
const HEADING_SIZES = ["small", "medium", "large"] as const;

const ALIGN_CLASS: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * The ramp is section headings, not page titles: `medium` is the size the
 * design's own section headings run at, `large` is the one that opens a
 * page or a campaign run, and `small` labels a shelf without competing with
 * the product names under it.
 */
const SIZE_CLASS: Record<string, string> = {
  small: "text-base font-bold tracking-tight sm:text-lg",
  medium: "text-[22px] font-bold tracking-[-0.03em] sm:text-[28px]",
  large: "text-[28px] font-bold tracking-[-0.03em] sm:text-[40px]",
};

function pick<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * v1 → v2: one `title` plus a design variant became two texts with explicit
 * alignment and size. The two-tone variant split its title at the last
 * space, so the migration performs that split ONCE and stores the halves —
 * the rendered result is unchanged, and the break is now editable.
 */
function migrateHeadingV1(instance: SectionInstance): SectionInstance {
  const settings = instance.settings ?? {};
  // Already two-field (an editor save of a migrated doc): only stamp on.
  if (typeof settings.accent === "string") {
    return { ...instance, version: 2 };
  }

  const flat = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const entry of Object.values(value)) {
        if (typeof entry === "string" && entry) return entry;
      }
    }
    return "";
  };

  const twoTone = settings.variant === "two-tone";
  const title = flat(settings.title).trim();
  const split = twoTone ? title.lastIndexOf(" ") : -1;

  return {
    ...instance,
    version: 2,
    settings: {
      // A single-word two-tone title stays whole and emphasised, exactly as
      // the old component rendered it.
      title: split > 0 ? title.slice(0, split) : twoTone ? "" : title,
      accent: twoTone ? (split > 0 ? title.slice(split + 1) : title) : "",
      align: twoTone ? "center" : "left",
      // Both old designs land on `medium`: it is exactly what the two-tone
      // heading rendered at, and the nearest step to the plain one. Neither
      // grows into `large`, which was added above them rather than under.
      size: "medium",
    },
  };
}

export const heading: SectionDefinition = {
  type: "heading",
  version: 2,
  category: "content",
  fields: [
    { key: "title", type: "text", translatable: true, default: "Heading" },
    // The emphasised half. Empty means a plain one-part heading, which is
    // why the lead-in keeps full ink until this is filled.
    { key: "accent", type: "text", translatable: true, default: "" },
    {
      key: "align",
      type: "select",
      options: HEADING_ALIGNMENTS,
      default: "left",
    },
    { key: "size", type: "select", options: HEADING_SIZES, default: "medium" },
  ],
  migrate: migrateHeadingV1,
  Render({ settings, ctx }: SectionRenderProps) {
    const title = lt(
      settings.title as LocalizedText,
      ctx.locale,
      ctx.defaultLanguage,
    ).trim();
    const accent = lt(
      settings.accent as LocalizedText,
      ctx.locale,
      ctx.defaultLanguage,
    ).trim();
    if (!title && !accent) return null;

    const align = pick(settings.align, HEADING_ALIGNMENTS, "left");
    const size = pick(settings.size, HEADING_SIZES, "medium");

    return (
      <section className="pt-6 lg:pt-10">
        <div className="container mx-auto px-4">
          <h2 className={cn(SIZE_CLASS[size], ALIGN_CLASS[align])}>
            {title ? (
              // The lead-in only recedes once there is an emphasised half to
              // recede against; on its own it is the heading.
              <span className={accent ? "text-foreground/35" : undefined}>
                {title}
              </span>
            ) : null}
            {title && accent ? " " : null}
            {accent ? (
              <span className="bg-gradient-to-r from-foreground to-foreground/35 bg-clip-text text-transparent">
                {accent}
              </span>
            ) : null}
          </h2>
        </div>
      </section>
    );
  },
};
