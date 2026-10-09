import {
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** The admin-configured social profile URLs, as `getStorefrontSettings()` returns them. */
export interface StoreSocialLinks {
  facebookUrl?: string;
  twitterUrl?: string;
  instagramUrl?: string;
  youtubeUrl?: string;
  linkedinUrl?: string;
  tiktokUrl?: string;
}

interface SocialItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * The social profiles that are actually set, in a fixed order. Shared by the
 * Contact and About pages so a new network is added in one place.
 */
export function buildSocialItems(social: StoreSocialLinks): SocialItem[] {
  const candidates: Array<{ label: string; href?: string; icon: LucideIcon }> = [
    { label: "Facebook", href: social.facebookUrl, icon: Facebook },
    { label: "Twitter", href: social.twitterUrl, icon: Twitter },
    { label: "Instagram", href: social.instagramUrl, icon: Instagram },
    { label: "YouTube", href: social.youtubeUrl, icon: Youtube },
    { label: "LinkedIn", href: social.linkedinUrl, icon: Linkedin },
  ];

  return candidates.flatMap((item) =>
    typeof item.href === "string" && item.href.trim().length > 0
      ? [{ label: item.label, href: item.href.trim(), icon: item.icon }]
      : [],
  );
}

/** Round primary buttons, one per profile — the storefront's social row. */
export function SocialIconLinks({
  items,
  className,
}: {
  items: SocialItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => (
        <a
          key={item.label}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={item.label}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <item.icon className="h-4 w-4" aria-hidden />
        </a>
      ))}
    </div>
  );
}

/** One contact fact: a filled icon disc, a label, and the value (linked when it can be). */
export function ContactRow({
  icon: Icon,
  title,
  value,
  href,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">
          {value}
        </span>
      </span>
    </>
  );

  if (href) {
    return (
      <a href={href} className="flex gap-4 transition-colors hover:text-primary">
        {content}
      </a>
    );
  }

  return <div className="flex gap-4">{content}</div>;
}
