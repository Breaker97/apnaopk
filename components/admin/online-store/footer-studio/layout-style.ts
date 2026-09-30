import {
  AtSign,
  Copyright,
  CreditCard,
  Image as ImageIcon,
  Link2,
  Share2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { FooterItemKind } from "@/lib/site-config/footer-layout";

/**
 * The palette, as DATA. One array drives the drawer chip, the canvas chip
 * and the drag overlay, so a kind cannot gain an icon in one place and keep
 * the old one in another — the header's own arrangement, for the same
 * reason.
 */
export interface FooterItemMeta {
  type: FooterItemKind;
  /** English fallback; the studio looks up a translation over this. */
  label: string;
  icon: LucideIcon;
}

export const FOOTER_ITEM_META: FooterItemMeta[] = [
  { type: "brand", label: "Logo", icon: ImageIcon },
  { type: "text", label: "Text", icon: Type },
  { type: "links", label: "Link column", icon: Link2 },
  { type: "contact", label: "Contact", icon: AtSign },
  { type: "social", label: "Social", icon: Share2 },
  { type: "payments", label: "Payment marks", icon: CreditCard },
  { type: "copyright", label: "Copyright", icon: Copyright },
];

/** Falls back to the first entry rather than throwing, as the header's does. */
export function footerItemMeta(type: FooterItemKind): FooterItemMeta {
  return FOOTER_ITEM_META.find((meta) => meta.type === type) ?? FOOTER_ITEM_META[0];
}

/** A one-line description of an item, for the canvas chip's subtitle. */
export function footerItemSummary(item: { type: FooterItemKind } & Record<string, unknown>): string {
  switch (item.type) {
    case "text":
      return typeof item.text === "string" && item.text.trim()
        ? item.text.trim().slice(0, 40)
        : "Store description";
    case "links": {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const menu = typeof item.menu === "string" ? item.menu.trim() : "";
      const count = Array.isArray(item.links) ? item.links.length : 0;
      if (menu) return `${title || "Menu"} · from menu`;
      return `${title || "Untitled"} · ${count} link${count === 1 ? "" : "s"}`;
    }
    case "contact":
      return typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : "Phone, email, address";
    case "copyright":
      return typeof item.text === "string" && item.text.trim()
        ? item.text.trim().slice(0, 40)
        : "Year and store name";
    case "payments":
      return typeof item.imageUrl === "string" && item.imageUrl.trim()
        ? "Artwork set"
        : "No artwork yet";
    case "brand":
      return "Store logo";
    case "social":
      return "Icons from Branding";
  }
  return "";
}
