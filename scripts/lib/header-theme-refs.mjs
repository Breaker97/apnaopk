/**
 * Which saved header colours are still the blue we shipped, and so should
 * follow Theme settings → Colors now that a header colour can.
 *
 * Until 3.1 the header's brand-coloured surfaces were saved as fixed hex: the
 * "All Categories" button, the "Tinted sidebar" category panel and the
 * "Banner nav" strip, each with white text. 3.1 makes them theme references
 * (`var(--theme-primary)`, whose text colour follows on its own), but only for
 * new headers — a stored header keeps its hex, so changing the brand colour
 * left these surfaces blue.
 *
 * Only an untouched default is converted: a surface still painted one of the
 * blues we shipped. A merchant who chose any other colour keeps it, and so
 * does a text colour that is not the default white. Pure: it reads a header
 * builder and returns the edits; the migration script writes them.
 */

/** The blues the header shipped with: code defaults and the Electronics seed. */
export const SHIPPED_PRIMARY_BLUES = ["#3b6ff5", "#366fff", "#2065d1"];
export const THEME_PRIMARY = "var(--theme-primary)";

const isSolid = (fill) =>
  Boolean(fill) && typeof fill === "object" && (fill.type === undefined || fill.type === "solid");

const isShippedBlue = (fill) =>
  isSolid(fill) &&
  typeof fill.color === "string" &&
  SHIPPED_PRIMARY_BLUES.includes(fill.color.trim().toLowerCase());

const isWhite = (fill) =>
  isSolid(fill) && typeof fill.color === "string" && /^#(fff|ffffff)$/i.test(fill.color.trim());

const at = (object, path) =>
  path.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), object);

/**
 * @param {unknown} builder `settings.header.builder`
 * @param {string} [base] the builder's path in the settings document
 * @returns {{ path: string, from: string, to?: string, unset?: true }[]}
 */
export function planHeaderThemeRefs(builder, base = "header.builder") {
  const changes = [];
  const rows = Array.isArray(builder?.rows) ? builder.rows : [];

  // A blue surface becomes the theme's primary; its white text is dropped so
  // the label, chevron and icon inherit the primary's own readable ink.
  const surface = (owner, path, inks) => {
    if (!isShippedBlue(owner?.background)) return;
    changes.push({ path: `${path}.background.color`, from: owner.background.color, to: THEME_PRIMARY });
    for (const ink of inks) {
      const fill = at(owner, ink);
      if (isWhite(fill)) changes.push({ path: `${path}.${ink}.color`, from: fill.color, unset: true });
    }
  };

  rows.forEach((row, r) => {
    const rowPath = `${base}.rows.${r}`;
    surface(row, rowPath, ["foreground"]);
    (Array.isArray(row?.columns) ? row.columns : []).forEach((column, c) => {
      (Array.isArray(column?.items) ? column.items : []).forEach((item, i) => {
        if (item?.type !== "categories") return;
        const itemPath = `${rowPath}.columns.${c}.items.${i}`;
        surface(item, itemPath, ["textStyle.fill", "foreground"]);
        if (item.panel) surface(item.panel, `${itemPath}.panel`, ["foreground"]);
      });
    });
  });
  return changes;
}
