"use client";

import { Button } from "@/components/ui/button";
import { PaddingField, PanelRow, UnitField } from "./header-studio/controls";
import { DEVICES, viewportDefaults, type LayoutDevice, type ViewportSettings, type ViewportDimensions } from "@/lib/site-config/responsive-dimensions";
import type { TSafe } from "./t-safe";

export function DeviceSelector({ device, onChange, tSafe }: { device: LayoutDevice; onChange: (device: LayoutDevice) => void; tSafe: TSafe }) {
  return <div className="flex gap-1" role="group" aria-label={tSafe("admin.responsive.device", "Screen size")}>
    {DEVICES.map((entry) => <Button key={entry} type="button" size="sm" variant={device === entry ? "default" : "outline"} aria-pressed={device === entry} onClick={() => onChange(entry)}>
      {tSafe(`admin.responsive.${entry}`, entry[0].toUpperCase() + entry.slice(1))}
    </Button>)}
  </div>;
}
export function ViewportFields({ device, settings, fullWidth, logoWidth, onChange, tSafe }: { device: LayoutDevice; settings?: ViewportSettings; fullWidth: boolean; logoWidth?: number; onChange: (settings: ViewportSettings) => void; tSafe: TSafe }) {
  const value = settings?.[device] ?? viewportDefaults(device, fullWidth, logoWidth);
  const patch = (next: Partial<ViewportDimensions>) => onChange({ ...settings, [device]: { ...value, ...next } });
  return <div className="space-y-3 rounded-md border p-3">
    <p className="text-sm font-medium">{tSafe(`admin.responsive.${device}`, device[0].toUpperCase() + device.slice(1))} · {tSafe("admin.responsive.container", "Content dimensions")}</p>
    <PanelRow label={tSafe("admin.responsive.width", "Max width")}><UnitField value={value.width} min={0} max={3200} unit="px" ariaLabel="Content max width" onChange={(width) => patch({ width })} /></PanelRow>
    <p className="text-xs text-muted-foreground">{tSafe("admin.responsive.widthHint", "0 uses the theme width. Changes apply only to the selected screen size.")}</p>
    <PanelRow label={tSafe("admin.responsive.padding", "Padding")} layout="stacked"><PaddingField value={value.padding} max={160} labels={{ top: "Top", right: "Right", bottom: "Bottom", left: "Left" }} onChange={(padding) => patch({ padding })} /></PanelRow>
    {logoWidth !== undefined && device !== "desktop" ? <PanelRow label={tSafe("admin.responsive.logoWidth", "Logo width")}><UnitField value={value.logoWidth} min={40} max={400} unit="px" ariaLabel="Logo width" onChange={(width) => patch({ logoWidth: width })} /></PanelRow> : null}
  </div>;
}
