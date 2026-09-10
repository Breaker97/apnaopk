import { LayoutGrid, List, Menu } from "lucide-react";

import type {
  CategoryTriggerIcon,
  CategoryTriggerSettings,
} from "@/lib/site-config/header-config";

/**
 * Renders the merchant's chosen glyph. Written as a switch returning literal
 * elements rather than a name→component lookup: picking a component out of a
 * map during render reads as building a component on the fly, which remounts
 * the subtree on every identity change and is what the React lint rule warns
 * about. Three branches cost less than that.
 */
export function CategoryTriggerGlyph({
  icon,
  className,
}: {
  icon: CategoryTriggerIcon;
  className?: string;
}) {
  if (icon === "grid") return <LayoutGrid className={className} />;
  if (icon === "list") return <List className={className} />;
  return <Menu className={className} />;
}

/**
 * The rail sits directly under the button and the two have to read as one card,
 * so its bottom corners follow the button's radius — capped, because a pill
 * button is a reasonable choice while a pill-bottomed 400px rail is not.
 */
export function getCategoryRailRadius(trigger: CategoryTriggerSettings) {
  return Math.min(trigger.borderRadius, 16);
}

/**
 * Room the flyout may take beside the rail: whatever the viewport has left once
 * the rail and a 48px margin are gone, capped at the four-column width the
 * grid is built for.
 */
export function getMegaFlyoutMaxWidth(railWidth: number) {
  return `min(940px, calc(100vw - ${railWidth + 48}px))`;
}
