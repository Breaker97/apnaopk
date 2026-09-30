import {
  FacebookGlyph,
  LinkedInGlyph,
  PinterestGlyph,
  TelegramGlyph,
  WhatsAppGlyph,
  XGlyph,
  type BrandGlyph,
} from "@/components/ui/brand-glyphs";

type ShareTarget = { url: string; title: string; image?: string };

type ShareNetwork = {
  key: "facebook" | "twitter" | "whatsapp" | "telegram" | "pinterest" | "linkedin";
  labelKey: string;
  fallbackLabel: string;
  icon: BrandGlyph;
  /** Hover colours in the network's own brand. */
  brandClass: string;
  href: (target: ShareTarget) => string;
};

const encode = encodeURIComponent;

/**
 * The networks a product can be shared to, in the order they are offered.
 * One list for both share rows: the product page's, drawn on the server, and
 * the seller page's, a client popover.
 */
export const SHARE_NETWORKS: readonly ShareNetwork[] = [
  {
    key: "facebook",
    labelKey: "product.share.facebook",
    fallbackLabel: "Share on Facebook",
    icon: FacebookGlyph,
    brandClass: "hover:border-[#1877F2] hover:text-[#1877F2]",
    href: ({ url }) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encode(url)}`,
  },
  {
    key: "twitter",
    labelKey: "product.share.twitter",
    fallbackLabel: "Share on X",
    icon: XGlyph,
    brandClass: "hover:border-foreground hover:text-foreground",
    href: ({ url, title }) =>
      `https://twitter.com/intent/tweet?url=${encode(url)}&text=${encode(title)}`,
  },
  {
    key: "whatsapp",
    labelKey: "product.share.whatsapp",
    fallbackLabel: "Share on WhatsApp",
    icon: WhatsAppGlyph,
    brandClass: "hover:border-[#25D366] hover:text-[#25D366]",
    href: ({ url, title }) => `https://wa.me/?text=${encode(title)}%20${encode(url)}`,
  },
  {
    key: "telegram",
    labelKey: "product.share.telegram",
    fallbackLabel: "Share on Telegram",
    icon: TelegramGlyph,
    brandClass: "hover:border-[#229ED9] hover:text-[#229ED9]",
    href: ({ url, title }) =>
      `https://t.me/share/url?url=${encode(url)}&text=${encode(title)}`,
  },
  {
    key: "pinterest",
    labelKey: "product.share.pinterest",
    fallbackLabel: "Pin it",
    icon: PinterestGlyph,
    brandClass: "hover:border-[#E60023] hover:text-[#E60023]",
    href: ({ url, title, image }) =>
      `https://pinterest.com/pin/create/button/?url=${encode(url)}&description=${encode(title)}${
        image ? `&media=${encode(image)}` : ""
      }`,
  },
  {
    key: "linkedin",
    labelKey: "product.share.linkedin",
    fallbackLabel: "Share on LinkedIn",
    icon: LinkedInGlyph,
    brandClass: "hover:border-[#0A66C2] hover:text-[#0A66C2]",
    href: ({ url }) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encode(url)}`,
  },
];

/** A `mailto:` that carries the page in its body. */
export function shareEmailHref({
  url,
  title,
  text,
}: {
  url: string;
  title: string;
  text: string;
}) {
  return `mailto:?subject=${encode(title)}&body=${encode(`${text}\n${url}`)}`;
}
