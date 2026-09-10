"use client";

import { useMemo, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Check, Link2, Mail, Share2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
// Shared with the vendor storefront's Store information panel, so a brand mark
// is defined once rather than per consumer.
import {
  FacebookGlyph,
  LinkedInGlyph,
  PinterestGlyph,
  TelegramGlyph,
  WhatsAppGlyph,
  XGlyph,
} from "@/components/ui/brand-glyphs";
import { useAppSettings } from "@/providers/app-settings-provider";
import { toast } from "@/components/ui/toast-notification";
import {
  buildCustomShareUrl,
  resolveShareSettings,
  type ShareSettings,
} from "@/lib/site-config/share-config";
import { cn } from "@/lib/utils";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useClientValue } from "@/hooks/use-client-value";

interface ProductShareButtonsProps {
  productName: string;
  /** Optional canonical URL. Defaults to the current page URL on the client. */
  url?: string;
  image?: string;
  shareText?: string;
  shareSettings?: ShareSettings;
  /**
   * Collapse the whole row behind a single share button.
   *
   * Used where the inline row would occupy space a higher-value action deserves
   * — a vendor storefront header, where four share icons were sitting in the
   * page's most prominent slot. Off by default so product pages keep the row.
   *
   * The trigger carries the share glyph, not a generic "more" ellipsis: an
   * ellipsis promises a mixed menu of actions and makes the shopper guess, while
   * the share icon is recognised on sight and costs exactly the same space.
   */
  compact?: boolean;
  /** Accessible name — and, from `sm` up, the visible label — of the trigger. */
  compactLabel?: string;
  /**
   * Render the compact trigger without its border or fill. Used in the vendor
   * storefront header, where Follow is meant to be the only filled control and a
   * bordered Share competes with it for the eye.
   */
  ghost?: boolean;
  /**
   * Button shape. "circle" is the classic bordered round icon with a leading
   * inline "Share" label. "tile" is the Minimal product page's flavor — gray
   * rounded rectangles, no inline label (the page renders its own "Share"
   * title row above).
   */
  variant?: "circle" | "tile";
  className?: string;
}

type SvgIcon = ComponentType<{ className?: string }>;

export function ProductShareButtons({
  productName,
  url,
  image,
  shareText: shareTextProp,
  shareSettings: shareSettingsOverride,
  compact = false,
  compactLabel,
  ghost = false,
  variant = "circle",
  className,
}: ProductShareButtonsProps) {
  const t = useTranslations();
  const { shareSettings: appShareSettings } = useAppSettings();
  const shareSettings = useMemo(
    () => resolveShareSettings(shareSettingsOverride ?? appShareSettings),
    [appShareSettings, shareSettingsOverride],
  );
  // The page's own address when no explicit url is given; empty until the
  // browser can answer, so the server and first client pass agree.
  const currentHref = useClientValue(() => window.location.href, "");
  const pageUrl = url || currentHref;
  const [copied, setCopied] = useState(false);

  const tr = useFallbackTranslator(t);

  const getSharePageUrl = () => {
    if (pageUrl) return pageUrl;
    if (url) return url;
    if (typeof window !== "undefined") return window.location.href;
    return "";
  };

  const encodedUrl = encodeURIComponent(pageUrl);
  const shareText =
    shareTextProp ||
    tr("product.shareProduct", "Share this product with friends and family");
  const encodedText = encodeURIComponent(productName);
  const encodedImage = image ? encodeURIComponent(image) : "";

  const networks = useMemo(() => {
    const items: Array<{
      key: string;
      enabled: boolean;
      label: string;
      href: string;
      icon: SvgIcon;
      brandClass: string;
    }> = [
      {
        key: "facebook",
        enabled: shareSettings.facebook,
        label: tr("product.share.facebook", "Share on Facebook"),
        href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
        icon: FacebookGlyph,
        brandClass: "hover:border-[#1877F2] hover:text-[#1877F2]",
      },
      {
        key: "twitter",
        enabled: shareSettings.twitter,
        label: tr("product.share.twitter", "Share on X"),
        href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
        icon: XGlyph,
        brandClass: "hover:border-foreground hover:text-foreground",
      },
      {
        key: "whatsapp",
        enabled: shareSettings.whatsapp,
        label: tr("product.share.whatsapp", "Share on WhatsApp"),
        href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
        icon: WhatsAppGlyph,
        brandClass: "hover:border-[#25D366] hover:text-[#25D366]",
      },
      {
        key: "telegram",
        enabled: shareSettings.telegram,
        label: tr("product.share.telegram", "Share on Telegram"),
        href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
        icon: TelegramGlyph,
        brandClass: "hover:border-[#229ED9] hover:text-[#229ED9]",
      },
      {
        key: "pinterest",
        enabled: shareSettings.pinterest,
        label: tr("product.share.pinterest", "Pin it"),
        href: `https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodedText}${
          encodedImage ? `&media=${encodedImage}` : ""
        }`,
        icon: PinterestGlyph,
        brandClass: "hover:border-[#E60023] hover:text-[#E60023]",
      },
      {
        key: "linkedin",
        enabled: shareSettings.linkedin,
        label: tr("product.share.linkedin", "Share on LinkedIn"),
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
        icon: LinkedInGlyph,
        brandClass: "hover:border-[#0A66C2] hover:text-[#0A66C2]",
      },
    ];
    return items.filter((item) => item.enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareSettings, encodedUrl, encodedText, encodedImage]);

  const customLinks = useMemo(
    () =>
      shareSettings.custom
        .filter(
          (item) =>
            item.enabled && item.label.trim() && item.urlTemplate.trim(),
        )
        .map((item) => ({
          id: item.id,
          label: item.label.trim(),
          iconUrl: item.icon?.trim() || "",
          urlTemplate: item.urlTemplate,
          href: buildCustomShareUrl(item.urlTemplate, {
            url: pageUrl,
            title: productName,
            image,
          }),
        }))
        .filter((item) => item.href),
    [shareSettings.custom, pageUrl, productName, image],
  );

  const showCopy = shareSettings.copyLink;
  const showEmail = shareSettings.email;

  const hasAnything =
    showCopy ||
    showEmail ||
    networks.length > 0 ||
    customLinks.length > 0;

  if (!shareSettings.enabled || !hasAnything) return null;

  const handleCopy = async () => {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      toast.success(tr("product.share.copied", "Link copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tr("common.error", "Something went wrong"));
    }
  };

  const emailHref = `mailto:?subject=${encodedText}&body=${encodeURIComponent(
    `${shareText}\n${pageUrl}`,
  )}`;

  // The gray rounded-rect flavor. Brand hover classes still recolor the
  // glyph; their border hovers are inert here (tiles draw no border).
  const shapeClass =
    variant === "tile"
      ? "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/70"
      : undefined;

  const row = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        compact ? "justify-start" : undefined,
        compact ? undefined : className,
      )}
    >
      {/* No leading "Share" label in compact mode (the trigger that opened
          this popover already says Share) or as tiles (the page renders its
          own title row) — repeating it is noise either way. */}
      {compact || variant === "tile" ? null : (
        <span className="mr-1 text-sm font-medium text-foreground">
          {tr("product.share.label", "Share")}
        </span>
      )}

      {networks.map((network) => (
        <ShareLink
          key={network.key}
          href={network.href}
          getHref={() => buildNetworkShareHref(network.key, {
            url: getSharePageUrl(),
            title: productName,
            image,
          })}
          label={network.label}
          icon={network.icon}
          base={shapeClass}
          className={network.brandClass}
        />
      ))}

      {customLinks.map((link) => (
        <ShareLink
          key={link.id}
          href={link.href}
          label={link.label}
          icon={Share2}
          iconUrl={link.iconUrl}
          base={shapeClass}
          getHref={() =>
            buildCustomShareUrl(link.urlTemplate, {
              url: getSharePageUrl(),
              title: productName,
              image,
            })
          }
          className="hover:border-foreground hover:text-foreground"
        />
      ))}

      {showEmail ? (
        <ShareLink
          href={emailHref}
          label={tr("product.share.email", "Share via email")}
          icon={Mail}
          external={false}
          base={shapeClass}
          className="hover:border-foreground hover:text-foreground"
        />
      ) : null}

      {showCopy ? (
        <ShareButton
          label={
            copied
              ? tr("product.share.copied", "Link copied")
              : tr("product.share.copyLink", "Copy link")
          }
          icon={copied ? Check : Link2}
          onClick={handleCopy}
          base={shapeClass}
          className={cn(
            "hover:border-foreground hover:text-foreground",
            copied && "border-green-500 text-green-600",
          )}
        />
      ) : null}
    </div>
  );

  if (!compact) return row;

  const triggerLabel = compactLabel || tr("product.share.label", "Share");

  return (
    <Popover>
      <PopoverTrigger
        aria-label={triggerLabel}
        className={cn(
          // Icon-only where space is tight; labelled from sm up, because a named
          // control is always easier to find than a bare glyph.
          "inline-flex h-9 items-center justify-center gap-2 rounded-full px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4",
          ghost
            ? "hover:bg-accent"
            : "border border-border bg-background hover:border-foreground",
          className,
        )}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{triggerLabel}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        {row}
      </PopoverContent>
    </Popover>
  );
}

const buttonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors";

function ShareButton(props: {
  label: string;
  icon: SvgIcon;
  onClick: () => void;
  /** Shape override (the tile flavor); defaults to the classic circle. */
  base?: string;
  className?: string;
}) {
  const { label, icon: Icon, onClick, base, className } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(base ?? buttonClass, className)}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ShareLink(props: {
  href: string;
  label: string;
  icon: SvgIcon;
  /** Optional uploaded icon URL; takes precedence over the glyph when set. */
  iconUrl?: string;
  getHref?: () => string;
  external?: boolean;
  /** Shape override (the tile flavor); defaults to the classic circle. */
  base?: string;
  className?: string;
}) {
  const {
    href,
    label,
    icon: Icon,
    iconUrl,
    getHref,
    external = true,
    base,
    className,
  } = props;
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      className={cn(base ?? buttonClass, className)}
      onClick={(event) => {
        if (!external || !getHref) return;
        const nextHref = getHref();
        if (!nextHref) return;
        event.preventDefault();
        window.open(nextHref, "_blank", "noopener,noreferrer");
      }}
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          className="h-4 w-4 object-contain"
          aria-hidden
        />
      ) : (
        <Icon className="h-4 w-4" />
      )}
    </a>
  );
}

function buildNetworkShareHref(
  key: string,
  values: { url: string; title: string; image?: string },
) {
  const encodedCurrentUrl = encodeURIComponent(values.url);
  const encodedTitle = encodeURIComponent(values.title);
  const encodedCurrentImage = values.image
    ? encodeURIComponent(values.image)
    : "";

  if (!encodedCurrentUrl) return "";

  if (key === "facebook") {
    return `https://www.facebook.com/sharer/sharer.php?u=${encodedCurrentUrl}`;
  }
  if (key === "twitter") {
    return `https://twitter.com/intent/tweet?url=${encodedCurrentUrl}&text=${encodedTitle}`;
  }
  if (key === "whatsapp") {
    return `https://wa.me/?text=${encodedTitle}%20${encodedCurrentUrl}`;
  }
  if (key === "telegram") {
    return `https://t.me/share/url?url=${encodedCurrentUrl}&text=${encodedTitle}`;
  }
  if (key === "pinterest") {
    return `https://pinterest.com/pin/create/button/?url=${encodedCurrentUrl}&description=${encodedTitle}${
      encodedCurrentImage ? `&media=${encodedCurrentImage}` : ""
    }`;
  }
  if (key === "linkedin") {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedCurrentUrl}`;
  }

  return "";
}
