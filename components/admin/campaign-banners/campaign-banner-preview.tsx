"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CampaignBar } from "@/components/store/campaign-banners/campaign-bar";
import {
  CampaignPopupBody,
  campaignPopupParts,
} from "@/components/store/campaign-banners/campaign-popup";
import { cn } from "@/lib/utils";
import {
  campaignBannerAsShown,
  campaignBannerCountdownEnd,
  type CampaignBannerDevice,
  type CampaignBannerFields,
  type StorefrontCampaignBanner,
} from "@/lib/campaign-banners/types";

/**
 * The widths a visitor sees it at: a popup with copy is 768px wide on a
 * desktop, and a phone is about 390px. The preview draws the banner AT those
 * widths and shrinks the picture to fit the editor's narrow column. Drawing it
 * at the column's own width would never reach the popup's two-column layout,
 * so Desktop and Mobile would look the same.
 */
const FRAME_WIDTH: Record<CampaignBannerDevice, number> = {
  desktop: 768,
  mobile: 390,
};

/**
 * A popup that is only a picture is as big as the picture is (up to 1024px),
 * so what it is drawn against is the window, not the popup: the frame stands
 * for a 1056px window with the popup centred in it, as on the shop. Without
 * that, a picture scaled to 50% would just fill the frame.
 */
const PICTURE_FRAME_WIDTH = 1056;

/** The editor's fields as the storefront would receive them. */
function asStorefrontBanner(editing: CampaignBannerFields): StorefrontCampaignBanner {
  // On the "Only image content" tab the preview draws just the picture, as the shop does.
  const fields = campaignBannerAsShown(editing);
  const afterSignup = fields.signup.enabled && Boolean(fields.couponCode);
  const end = campaignBannerCountdownEnd(fields);
  return {
    id: "preview",
    type: fields.type,
    priority: fields.priority,
    updatedAt: "",
    schedule: fields.schedule,
    content: fields.content,
    couponCode: afterSignup ? "" : fields.couponCode,
    couponOffer: "",
    couponAfterSignup: afterSignup,
    countdown: { enabled: Boolean(end), endsAt: end },
    signup: fields.signup,
    rules: fields.rules,
  };
}

/**
 * The live preview beside the editor: the same components the shop renders,
 * at a phone's width or a desktop's. Nothing in it sends anything.
 */
export function CampaignBannerPreview({
  fields,
  themeRadius = null,
}: {
  fields: CampaignBannerFields;
  /** The store theme's card radius in px; the popup's corners on the shop. */
  themeRadius?: number | null;
}) {
  const t = useTranslations("admin.campaignBanners.preview");
  const [device, setDevice] = useState<CampaignBannerDevice>("desktop");
  const banner = useMemo(() => asStorefrontBanner(fields), [fields]);
  const empty =
    !banner.content.headline &&
    !banner.content.body &&
    !banner.content.imageDesktop &&
    !banner.content.imageMobile;

  const slot = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    const measure = () => setAvailable(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pictureOnly = fields.type === "popup" && campaignPopupParts(banner).pictureOnly;
  const width =
    pictureOnly && device === "desktop" ? PICTURE_FRAME_WIDTH : FRAME_WIDTH[device];
  // Never enlarged past life size; 1 until the column has been measured.
  const scale = available > 0 ? Math.min(1, available / width) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("title")}</p>
        <div className="flex gap-1" role="group" aria-label={t("device")}>
          {(["desktop", "mobile"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={device === value ? "default" : "outline"}
              aria-pressed={device === value}
              onClick={() => setDevice(value)}
            >
              {value === "desktop" ? (
                <Monitor className="h-4 w-4" />
              ) : (
                <Smartphone className="h-4 w-4" />
              )}
              {t(value)}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3">
        <div ref={slot} className="w-full">
          <div
            className={cn(
              "mx-auto overflow-hidden border shadow-sm",
              // A popup's frame IS the popup's edge, so it wears the store
              // theme's card radius; the picture-only stage and a bar do not.
              fields.type === "popup" && !pictureOnly
                ? "rounded-[var(--store-radius-card,var(--radius))]"
                : "rounded-lg",
              pictureOnly ? "bg-muted p-4" : "bg-background",
            )}
            style={{
              width,
              zoom: scale,
              ...(themeRadius === null
                ? {}
                : ({ "--store-radius-card": `${themeRadius}px` } as CSSProperties)),
            }}
          >
            {empty ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </p>
            ) : fields.type === "bar" ? (
              <CampaignBar banner={banner} onDismiss={() => {}} inPreview />
            ) : pictureOnly ? (
              <div className="mx-auto w-max max-w-full">
                <CampaignPopupBody
                  banner={banner}
                  onDismiss={() => {}}
                  device={device}
                  preview
                />
              </div>
            ) : (
              <CampaignPopupBody
                banner={banner}
                onDismiss={() => {}}
                device={device}
                preview
              />
            )}
          </div>
        </div>
      </div>
      {banner.couponAfterSignup ? (
        <p className="text-xs text-muted-foreground">{t("codeAfterSignup")}</p>
      ) : null}
    </div>
  );
}
