/**
 * Whether a saved AI sales widget still wears the purple it shipped with, and
 * so should follow Theme settings → Colors like a new store's widget does.
 *
 * Until 3.1 the widget defaulted to a fixed purple gradient (#7c3aed →
 * #a855f7). 3.1 makes both stops the theme's primary (`var(--theme-primary)`,
 * text in its own readable ink). Only an untouched widget is converted: both
 * stops still the shipped purple. A merchant who changed either stop chose the
 * widget's colours, and both are kept. Pure: the migration script writes.
 */

export const SHIPPED_WIDGET_COLORS = { primaryColor: "#7c3aed", accentColor: "#a855f7" };
export const THEME_PRIMARY = "var(--theme-primary)";

const same = (value, expected) =>
  typeof value === "string" && value.trim().toLowerCase() === expected;

/**
 * @param {unknown} widget `settings.aiSalesAgent.widget`
 * @param {string} [base] the widget's path in the settings document
 * @returns {{ path: string, from: string, to: string }[]}
 */
export function planAiWidgetThemeRefs(widget, base = "aiSalesAgent.widget") {
  if (!widget || typeof widget !== "object") return [];
  const untouched = Object.entries(SHIPPED_WIDGET_COLORS).every(([key, color]) => same(widget[key], color));
  if (!untouched) return [];
  return Object.keys(SHIPPED_WIDGET_COLORS).map((key) => ({
    path: `${base}.${key}`,
    from: widget[key],
    to: THEME_PRIMARY,
  }));
}
