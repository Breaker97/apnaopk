/**
 * The active theme, compiled for an admin surface: the custom properties
 * and data attributes `compileTheme` produces, handed to a client preview
 * so it can stand on the storefront's own ground — a `.store-surface` box
 * carrying these renders fonts, radii and button styling as the store does.
 */
export interface StoreSurface {
  vars: Record<string, string>;
  attributes: Record<string, string>;
}
