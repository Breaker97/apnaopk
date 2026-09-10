import {
  CircleHelp,
  Gift,
  Mail,
  MapPin,
  Package,
  Phone,
  Rss,
  Store,
  Tag,
  Truck,
  type LucideIcon,
} from "lucide-react";
import {
  linkGlyph,
  type HeaderLinkGlyph,
} from "@/lib/site-config/header-layout";

/**
 * The built-in link glyphs, drawn — see HEADER_LINK_GLYPHS. One map for the
 * storefront header, the studio preview and the links editor, so a glyph a
 * merchant picks is the glyph a shopper sees.
 */
const LINK_GLYPH_ICON: Record<HeaderLinkGlyph, LucideIcon> = {
  package: Package,
  rss: Rss,
  phone: Phone,
  mail: Mail,
  store: Store,
  help: CircleHelp,
  truck: Truck,
  gift: Gift,
  tag: Tag,
  "map-pin": MapPin,
};

/**
 * A built-in glyph, drawn. A component rather than a lookup at the call
 * site: picking a component out of a map inside a render (or a map
 * callback) reads to the compiler as building one on the fly.
 */
export function LinkGlyph({
  glyph,
  className,
}: {
  glyph: HeaderLinkGlyph;
  className?: string;
}) {
  const Glyph = LINK_GLYPH_ICON[glyph];
  return <Glyph className={className} />;
}

/** The glyph an icon value names, drawn; nothing for an image or "". */
export function LinkGlyphIcon({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const glyph = linkGlyph(icon);
  return glyph ? <LinkGlyph glyph={glyph} className={className} /> : null;
}
