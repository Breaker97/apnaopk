import { ChevronDown, Circle, CircleDot, Square, Tag } from "lucide-react";
import type { OptionVisual } from "@/lib/products/option-visual";

/**
 * The visual choices shown in the admin variant editors (Global Variants and the
 * product option editor), with their picker icons. Kept in one place so both
 * editors stay in sync. "Image" is deliberately absent — see option-visual.ts.
 */
export const VISUAL_OPTIONS: {
  value: OptionVisual;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "rectangle", label: "Rectangle", icon: <Square className="size-4" /> },
  { value: "dropdown", label: "Dropdown", icon: <ChevronDown className="size-4" /> },
  { value: "circle", label: "Circle", icon: <Circle className="size-4" /> },
  {
    value: "color",
    label: "Color",
    icon: <span className="size-3.5 rounded-full bg-rose-500" />,
  },
  { value: "color_label", label: "Color & Label", icon: <Tag className="size-4" /> },
  { value: "radio", label: "Radio Button", icon: <CircleDot className="size-4" /> },
];
