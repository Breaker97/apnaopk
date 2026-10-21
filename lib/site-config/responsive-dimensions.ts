import type { CSSProperties } from "react";
import type { HeaderPadding } from "./header-layout";
import { isRecord } from "@/lib/utils";

export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type LayoutDevice = typeof DEVICES[number];
export interface Dimensions {
  padding?: HeaderPadding;
  width?: number;
  size?: number;
}
export type ResponsiveDimensions = Partial<Record<LayoutDevice, Dimensions>>;
export interface ViewportDimensions {
  /** 0 follows the theme container. */
  width: number;
  padding: HeaderPadding;
  logoWidth: number;
}
export type ViewportSettings = Partial<Record<LayoutDevice, ViewportDimensions>>;

function bounded(value: unknown, fallback: number, max: number, min = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback;
}
function readPadding(value: unknown, fallback: HeaderPadding): HeaderPadding {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(fallback).map(([key, base]) =>
    [key, bounded(source[key], base, 160)])) as unknown as HeaderPadding;
}
export function normalizeDimensions(value: unknown): ResponsiveDimensions | undefined {
  if (!isRecord(value)) return undefined;
  const result: ResponsiveDimensions = {};
  for (const device of DEVICES) {
    const source = value[device];
    if (!isRecord(source)) continue;
    result[device] = {
      ...(source.padding !== undefined ? { padding: readPadding(source.padding, { top: 0, right: 0, bottom: 0, left: 0 }) } : {}),
      ...(source.width !== undefined ? { width: bounded(source.width, 1, 12, 1) } : {}),
      ...(source.size !== undefined ? { size: bounded(source.size, 0, 400) } : {}),
    };
  }
  return result;
}

export function resolveDimensions<T extends { responsive?: ResponsiveDimensions }>(node: T, device: LayoutDevice): T {
  return { ...node, ...node.responsive?.[device] };
}

/** Desktop is also an override: the legacy base stays frozen for other devices. */
export function patchDimensions<T extends { responsive?: ResponsiveDimensions }>(node: T, patch: Partial<T>, device: LayoutDevice): T {
  const shared = { ...patch };
  const dimensions: Dimensions = { ...node.responsive?.[device] };
  for (const key of ["width", "padding", "size"] as const) {
    if (key in shared) {
      Object.assign(dimensions, { [key]: shared[key as keyof T] });
      delete shared[key as keyof T];
    }
  }
  return { ...node, ...shared, responsive: { ...node.responsive, [device]: dimensions } };
}
export function responsivePaddingStyle(node: { padding: HeaderPadding; responsive?: ResponsiveDimensions }): CSSProperties {
  const result: Record<string, string> = {};
  for (const device of DEVICES) {
    const p = resolveDimensions(node, device).padding;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      result[`--pad-${side}-${device}`] = `${p[side]}px`;
    }
  }
  // --layout-device-* are defined on the storefront root by media queries.
  for (const side of ["top", "right", "bottom", "left"] as const) {
    result[`padding${side[0].toUpperCase()}${side.slice(1)}`] = `calc(var(--layout-mobile) * var(--pad-${side}-mobile) + var(--layout-tablet) * var(--pad-${side}-tablet) + var(--layout-desktop) * var(--pad-${side}-desktop))`;
  }
  return result as CSSProperties;
}
export function viewportDefaults(device: LayoutDevice, fullWidth = false, logoWidth = 112): ViewportDimensions {
  const gutter = fullWidth ? device === "desktop" ? 32 : device === "tablet" ? 24 : 16 : 16;
  return { width: fullWidth ? 3200 : 0, padding: { top: 0, right: gutter, bottom: 0, left: gutter }, logoWidth };
}
export function normalizeViewportSettings(value: unknown): ViewportSettings | undefined {
  if (!isRecord(value)) return undefined;
  const result: ViewportSettings = {};
  for (const device of DEVICES) {
    const source = value[device];
    if (!isRecord(source)) continue;
    const base = viewportDefaults(device);
    result[device] = {
      width: bounded(source.width, 0, 3200),
      padding: readPadding(source.padding, base.padding),
      logoWidth: bounded(source.logoWidth, 112, 400, 40),
    };
  }
  return result;
}
export function viewportStyle(settings: ViewportSettings | undefined, fullWidth: boolean, logoWidth = 112): CSSProperties {
  const responsive: ResponsiveDimensions = {};
  const variables: Record<string, string> = {};
  for (const device of DEVICES) {
    const value = settings?.[device] ?? viewportDefaults(device, fullWidth, logoWidth);
    responsive[device] = { padding: value.padding };
    variables[`--chrome-width-${device}`] = value.width ? `${value.width}px` : "var(--chrome-theme-width, var(--theme-container-width, 100%))";
    variables[`--chrome-logo-${device}`] = `${value.logoWidth}px`;
  }
  const style = responsivePaddingStyle({ padding: viewportDefaults("mobile").padding, responsive });
  // Preserve the theme's existing gutter until this device gets an override.
  for (const device of DEVICES) {
    if (settings?.[device]) continue;
    for (const side of ["left", "right"]) {
      variables[`--pad-${side}-${device}`] = fullWidth
        ? device === "mobile" ? "var(--chrome-full-mobile-gutter, 16px)" : device === "tablet" ? "24px" : "32px"
        : "var(--chrome-theme-padding, 16px)";
    }
  }
  return { ...style, ...variables } as CSSProperties;
}
