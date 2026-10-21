"use client";

import { useState, type CSSProperties, type ElementType } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CampaignBannerDevice,
  StorefrontCampaignBanner,
} from "@/lib/campaign-banners/types";
import { cn } from "@/lib/utils";
import {
  CampaignBannerCountdown,
  CampaignBannerCoupon,
  CampaignBannerCta,
  CampaignBannerImage,
  campaignBannerColors,
  useCampaignBannerText,
} from "./campaign-banner-parts";
import { CampaignSignupForm } from "./campaign-signup-form";

/**
 * The store theme's card radius: the corners of the popup and of its picture,
 * whatever its layout. `--radius` is the fallback where the theme sets none.
 */
const THEME_RADIUS = "rounded-[var(--store-radius-card,var(--radius))]";

/**
 * The card radius the theme sets, read off the storefront surface. The dialog
 * is portaled onto <body>, which gets the theme's tokens only once the theme
 * sync has run (it waits for an idle moment), so a popup that opens first
 * would wear the fallback and then change its corners. Handing the value to
 * the dialog itself makes them the theme's from the first frame.
 */
function readThemeCardRadius(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const surface = document.querySelector<HTMLElement>(".store-surface");
  if (!surface) return undefined;
  return getComputedStyle(surface).getPropertyValue("--store-radius-card").trim() || undefined;
}

/** What a popup is made of, so the modal, its body and the preview agree. */
export function campaignPopupParts(banner: StorefrontCampaignBanner) {
  const { content } = banner;
  const hasImage = Boolean(content.imageDesktop || content.imageMobile);
  const hasCopy = Boolean(
    content.headline ||
      content.body ||
      banner.couponCode ||
      banner.countdown.enabled ||
      banner.signup.enabled ||
      content.ctaLabel,
  );
  return { hasImage, hasCopy, pictureOnly: hasImage && !hasCopy };
}

/**
 * A popup that is only a picture. The popup is as big as the picture is: its
 * own size, times the editor's scale, and never wider than the screen. So the
 * scale is read against the picture's own width, which is known once it has
 * loaded; until then a scaled picture waits unseen rather than jumping.
 */
function PicturePopupBody({
  banner,
  onDismiss,
  Title,
  device,
}: {
  banner: StorefrontCampaignBanner;
  onDismiss: () => void;
  Title: ElementType;
  device?: CampaignBannerDevice;
}) {
  const say = useCampaignBannerText();
  const { content } = banner;
  const [naturalWidth, setNaturalWidth] = useState(0);
  // A copy of the banner cached before the option existed has no scale.
  const scale = content.imageScale || 100;
  const scaled = scale !== 100;
  const style: CSSProperties = {
    ...(scaled && naturalWidth > 0
      ? { width: Math.round((naturalWidth * scale) / 100) }
      : {}),
    ...(scaled && naturalWidth === 0 ? { visibility: "hidden" } : {}),
  };
  const image = (
    <CampaignBannerImage
      content={content}
      device={device}
      onNaturalWidth={setNaturalWidth}
      className={cn("h-auto w-auto max-w-full", THEME_RADIUS)}
      style={style}
    />
  );
  return (
    <>
      {content.ctaHref ? (
        <Link href={content.ctaHref} onClick={onDismiss} className="block">
          {image}
        </Link>
      ) : (
        image
      )}
      <Title className="sr-only">
        {content.imageAlt || say("title", "Special offer")}
      </Title>
    </>
  );
}

/**
 * What is inside a popup. Shared by the modal below and the dashboard's live
 * preview, so the editor draws exactly what the shop draws.
 *
 * With artwork the popup is two columns once it is wide enough (image beside
 * the copy) and stacked below that — decided by the popup's own width, not
 * the window's, so a narrow preview lays out like a phone. With nothing but
 * artwork it is just the picture (see `PicturePopupBody`), linked when the
 * banner has a link.
 *
 * `Title` and `Description` are the dialog's own parts in the modal (Radix
 * wires them to the dialog's name and description) and plain elements in the
 * preview, where there is no dialog.
 */
export function CampaignPopupBody({
  banner,
  onDismiss,
  Title = "h2",
  Description = "p",
  device,
  preview = false,
}: {
  banner: StorefrontCampaignBanner;
  onDismiss: () => void;
  Title?: ElementType;
  Description?: ElementType;
  /** Which artwork to draw, when the viewer's window is not the answer. */
  device?: CampaignBannerDevice;
  /** The dashboard's preview: nothing in it sends anything. */
  preview?: boolean;
}) {
  const say = useCampaignBannerText();
  const { content } = banner;

  const { hasImage, pictureOnly } = campaignPopupParts(banner);
  if (pictureOnly) {
    return (
      <PicturePopupBody
        banner={banner}
        onDismiss={onDismiss}
        Title={Title}
        device={device}
      />
    );
  }
  const buttonStyle: CSSProperties = {
    ...(content.buttonColor ? { backgroundColor: content.buttonColor } : {}),
    ...(content.buttonTextColor ? { color: content.buttonTextColor } : {}),
  };

  const image = (
    <CampaignBannerImage
      content={content}
      device={device}
      className="@2xl:absolute @2xl:inset-0"
    />
  );

  return (
    <div
      className={cn(
        "@container",
        !content.backgroundColor && "bg-background text-foreground",
      )}
      style={campaignBannerColors(content)}
    >
      <div className={cn(hasImage && "grid @2xl:grid-cols-2")}>
        {hasImage ? (
          <div className="relative aspect-[16/10] overflow-hidden @2xl:aspect-auto @2xl:min-h-[22rem]">
            {image}
          </div>
        ) : null}

        <div className="flex flex-col justify-center gap-4 p-6 @2xl:p-8">
          <Title
            className={cn(
              "text-2xl leading-tight font-bold",
              !content.headline && "sr-only",
            )}
          >
            {content.headline || say("title", "Special offer")}
          </Title>
          {content.body ? (
            <Description className="text-base text-current opacity-80">
              {content.body}
            </Description>
          ) : null}

          <CampaignBannerCountdown countdown={banner.countdown} />
          <CampaignBannerCoupon banner={banner} />

          {banner.signup.enabled ? (
            <CampaignSignupForm
              banner={banner}
              buttonStyle={buttonStyle}
              preview={preview}
            />
          ) : (
            <div>
              <CampaignBannerCta content={content} onFollow={onDismiss} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The popup shell: a modal over the page. Radix gives it the focus trap, ESC
 * and the click-outside close; every way out comes back through `onDismiss`,
 * which is what starts the banner's quiet period.
 */
export function CampaignPopup({
  banner,
  open,
  onDismiss,
}: {
  banner: StorefrontCampaignBanner;
  open: boolean;
  onDismiss: () => void;
}) {
  const tCommon = useTranslations("common");
  const { content } = banner;
  const { hasImage, pictureOnly } = campaignPopupParts(banner);
  const [themeRadius] = useState(readThemeCardRadius);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent
        showCloseButton={false}
        style={
          themeRadius ? ({ "--store-radius-card": themeRadius } as CSSProperties) : undefined
        }
        // Radix warns about a missing description; with no body there is none.
        {...(content.body ? {} : { "aria-describedby": undefined })}
        className={cn(
          "max-h-[90svh] gap-0 overflow-y-auto overflow-x-hidden p-0",
          THEME_RADIUS,
          // The dialog's own `calc(100% - 2rem)` gutter only applies below
          // `sm`, hence the `min()`s. A picture alone IS the popup: it is
          // as wide as the picture (`w-max`, not `w-fit`: the dialog sits at
          // `left: 50%`, so fit-content would only see half the window),
          // up to a limit, with no frame of its own.
          pictureOnly
            ? "w-max border-0 bg-transparent sm:max-w-[min(64rem,calc(100%_-_2rem))]"
            : hasImage
              ? "sm:max-w-[min(48rem,calc(100%_-_2rem))]"
              : "sm:max-w-md",
        )}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label={tCommon("close")}
          className="absolute end-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <X className="h-4 w-4" />
        </button>
        <CampaignPopupBody
          banner={banner}
          onDismiss={onDismiss}
          Title={DialogTitle}
          Description={DialogDescription}
        />
      </DialogContent>
    </Dialog>
  );
}
