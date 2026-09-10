import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  backgroundCss,
  hasBackground,
  type SlideBackground,
} from "@/lib/sliders/types";
import {
  announcementBarCss,
  announcementTextCss,
  defaultAnnouncementStyle,
  type AnnouncementStyle,
} from "@/lib/site-config/announcement-style";

/**
 * The slim strip above the header — free-shipping notices, sale windows,
 * store announcements. The background is a colour, a gradient or an image
 * from the section settings (unset means the theme's primary scheme); the
 * whole bar is the link when one is set.
 *
 * Its height, the alignment that seats the message inside that height, and
 * the message's own type all come from the Header Studio's "Announcement
 * bar" row — see AnnouncementStyle.
 */
export function AnnouncementBar({
  locale,
  text,
  href,
  background,
  style: barStyle = defaultAnnouncementStyle(),
}: {
  locale: string;
  text: string;
  href: string;
  background: SlideBackground;
  style?: AnnouncementStyle;
}) {
  if (!text.trim()) return null;

  const painted = hasBackground(background);
  const style = {
    ...backgroundCss(background),
    ...announcementBarCss(barStyle),
  };
  const body = (
    <span
      className="inline-flex items-center justify-center gap-1.5"
      style={announcementTextCss(barStyle)}
    >
      <span className="truncate">{text}</span>
      {href ? <ArrowRight className="h-3.5 w-3.5 shrink-0 rtl:rotate-180" /> : null}
    </span>
  );
  const className = "block w-full px-4 py-2 leading-5";
  const fallbackClass = painted ? "" : " bg-primary text-primary-foreground";

  if (href) {
    const target = href.startsWith("http") ? href : `/${locale}${href.startsWith("/") ? href : `/${href}`}`;
    const external = href.startsWith("http");
    return external ? (
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer"
        className={className + fallbackClass + " transition-opacity hover:opacity-90"}
        style={style}
      >
        {body}
      </a>
    ) : (
      <Link
        href={target}
        className={className + fallbackClass + " transition-opacity hover:opacity-90"}
        style={style}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={className + fallbackClass} style={style}>
      {body}
    </div>
  );
}
