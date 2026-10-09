import { ArrowRight, Megaphone } from "lucide-react";
import Link from "@/components/language/link";
import {
  accentForeground,
  type VendorPageAnnouncement,
} from "@/lib/vendors/vendor-store-page";

/**
 * The vendor's notice at the top of their Home tab ("Eid sale — 20% off").
 * Its own colour when set; otherwise the page's accent through the theme's
 * primary tokens, which the vendor's accent already repaints. The whole
 * strip is the link when there is one — always a path on this marketplace.
 */
export function VendorAnnouncement({
  announcement,
}: {
  announcement: VendorPageAnnouncement;
}) {
  const style = announcement.color
    ? {
        backgroundColor: announcement.color,
        color: accentForeground(announcement.color),
      }
    : undefined;
  const className = `flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-center text-sm font-medium ${
    style ? "" : "bg-primary text-primary-foreground"
  }`;
  const body = (
    <>
      <Megaphone className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">{announcement.text}</span>
      {announcement.link ? (
        <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
      ) : null}
    </>
  );

  return announcement.link ? (
    <Link
      href={announcement.link}
      className={`${className} transition-opacity hover:opacity-90`}
      style={style}
    >
      {body}
    </Link>
  ) : (
    <p role="status" className={className} style={style}>
      {body}
    </p>
  );
}
