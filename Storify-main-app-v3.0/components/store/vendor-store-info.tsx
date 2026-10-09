"use client";

import { useState } from "react";
import {
  ChevronRight,
  Copy,
  Globe,
  Link2,
  MapPin,
  Navigation,
  Phone,
  Store,
} from "lucide-react";
import {
  FacebookGlyph,
  InstagramGlyph,
  LinkedInGlyph,
  PinterestGlyph,
  TelegramGlyph,
  TikTokGlyph,
  WhatsAppGlyph,
  XGlyph,
  YouTubeGlyph,
  type BrandGlyph,
} from "@/components/ui/brand-glyphs";
import {
  socialProfileLabel,
  type SocialPlatform,
  type SocialProfile,
} from "@/lib/site-config/social-profiles";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast-notification";
import { buildDirectionsUrl } from "@/lib/vendors/vendor-address";
import { cn } from "@/lib/utils";
import type { StorefrontVendorPickup } from "@/lib/storefront/storefront-vendors";

export interface VendorStoreInfoLabels {
  heading: string;
  address: string;
  basedIn: string;
  pickup: string;
  /**
   * Fully resolved, e.g. "Ready in 1–2 days"; empty when the vendor set no
   * window. Interpolated on the page so `t()` gets its ICU values there.
   */
  pickupReady: string;
  online: string;
  phone: string;
  copy: string;
  copied: string;
  directions: string;
}

export interface VendorStoreInfoData {
  /** Pre-formatted address lines. Empty/absent hides the whole address field. */
  addressLines?: string[];
  /** Empty when the precision is too coarse to route to — hides Directions. */
  mapQuery?: string;
  /**
   * Geocoded point for the Directions link. When present the link opens the
   * exact spot rather than a text search, which is the only way the pin
   * reliably matches the address printed above it.
   */
  mapCoordinates?: { lat: number; lng: number };
  phone?: string;
  pickup?: StorefrontVendorPickup;
  socialProfiles?: SocialProfile[];
}

interface VendorStoreInfoProps extends VendorStoreInfoData {
  labels: VendorStoreInfoLabels;
  /**
   * Suppress the panel's own heading where the surrounding chrome already
   * supplies one — the mobile sheet has its own title, and rendering both
   * printed "Store information" twice.
   */
  hideHeading?: boolean;
  /**
   * `card` boxes the panel; `plain` drops the frame.
   *
   * The storefront sidebar uses `plain`, because the filter groups beneath it
   * have no frame either — one boxed block above four unboxed ones read as two
   * unrelated columns. The About tab keeps `card`, where this sits beside other
   * boxed facts and the frame is what makes them a set.
   */
  variant?: "card" | "plain";
  className?: string;
}

/**
 * Whether the panel has anything to say. Callers use this to drop their own
 * chrome too — a mobile "Store details" row that opens an empty sheet is worse
 * than no row at all.
 */
function hasVendorStoreInfo({
  addressLines,
  phone,
  pickup,
  socialProfiles,
}: VendorStoreInfoData): boolean {
  if (addressLines?.length) return true;
  if (phone?.trim()) return true;
  if (pickup?.address || pickup?.instructions || pickup?.readyInDaysMax) {
    return true;
  }
  return Boolean(socialProfiles?.length);
}

/**
 * Brand mark per platform. `other` has no mark of its own, so it borrows the
 * generic link glyph — the accessible name carries the vendor's own label.
 */
const PLATFORM_GLYPHS: Record<SocialPlatform, BrandGlyph> = {
  facebook: FacebookGlyph,
  instagram: InstagramGlyph,
  x: XGlyph,
  youtube: YouTubeGlyph,
  tiktok: TikTokGlyph,
  linkedin: LinkedInGlyph,
  pinterest: PinterestGlyph,
  whatsapp: WhatsAppGlyph,
  telegram: TelegramGlyph,
  other: Link2,
};

/** Profile URLs are often typed without a scheme; `href` needs one. */
function normalizeWebsite(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
    >
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * Store information panel for the vendor storefront — the full-precision home
 * for the address, alongside pickup and social links.
 *
 * Renders nothing at all when there is no field to show, rather than an empty
 * bordered card. Address content arrives pre-formatted and already gated by the
 * server, so this component never has to decide what may be published.
 */
export function VendorStoreInfo({
  labels,
  addressLines,
  mapQuery,
  mapCoordinates,
  phone,
  pickup,
  socialProfiles,
  hideHeading = false,
  variant = "card",
  className,
}: VendorStoreInfoProps) {
  const [copied, setCopied] = useState(false);

  const hasAddress = Boolean(addressLines?.length);
  // A city-only address has no mapQuery: offering Directions there would send
  // the buyer to the middle of a city and look broken.
  const canRoute = Boolean(mapQuery);
  const profiles = socialProfiles ?? [];
  const hasOnline = profiles.length > 0;
  const hasAnything = hasVendorStoreInfo({
    addressLines,
    phone,
    pickup,
    socialProfiles,
  });
  const pickupReady = labels.pickupReady;
  const hasPickup = Boolean(
    pickup && (pickup.address || pickup.instructions || pickupReady),
  );

  if (!hasAnything) return null;

  const handleCopy = async () => {
    const text = (addressLines ?? []).join("\n");
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(labels.copied);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(labels.copy);
    }
  };

  return (
    <section
      className={cn(
        variant === "card" && "rounded-xl border bg-card p-4",
        className,
      )}
    >
      {hideHeading ? null : (
        // `tracking-wide` matches the filter group headings this sits above in
        // the storefront sidebar.
        <h2 className="mb-1 text-sm font-bold tracking-wide">
          {labels.heading}
        </h2>
      )}

      {hasAddress ? (
        <Field
          icon={MapPin}
          label={canRoute ? labels.address : labels.basedIn}
        >
          <address className="text-sm not-italic leading-relaxed">
            {addressLines?.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleCopy}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {copied ? labels.copied : labels.copy}
            </Button>
            {canRoute ? (
              <Button asChild variant="outline" size="sm" className="h-8">
                <a
                  href={buildDirectionsUrl(mapQuery as string, mapCoordinates)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.directions}
                </a>
              </Button>
            ) : null}
          </div>
        </Field>
      ) : null}

      {phone ? (
        <Field icon={Phone} label={labels.phone}>
          <a
            href={`tel:${phone.replace(/\s+/g, "")}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {phone}
          </a>
        </Field>
      ) : null}

      {hasPickup ? (
        <Field icon={Store} label={labels.pickup}>
          {pickup?.address ? (
            <address className="text-sm not-italic leading-relaxed">
              {pickup.address}
            </address>
          ) : null}
          {pickupReady ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{pickupReady}</p>
          ) : null}
          {pickup?.instructions ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {pickup.instructions}
            </p>
          ) : null}
        </Field>
      ) : null}

      {hasOnline ? (
        <Field icon={Globe} label={labels.online}>
          {profiles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {profiles.map((profile) => {
                const Glyph = PLATFORM_GLYPHS[profile.platform] ?? Link2;
                const name = socialProfileLabel(profile);
                return (
                  <a
                    key={profile.id}
                    href={normalizeWebsite(profile.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={name}
                    title={name}
                    className="grid h-8 w-8 place-items-center rounded-lg border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Glyph className="h-3.5 w-3.5" />
                  </a>
                );
              })}
            </div>
          ) : null}
        </Field>
      ) : null}
    </section>
  );
}

/**
 * Mobile entry point: a single disclosure row that opens the same panel in a
 * sheet. Keeps the full address one tap away so the first product row still
 * lands inside the opening screen — on a phone the store page's job is browsing
 * products, not reading a business card.
 */
export function VendorStoreInfoMobile({
  labels,
  triggerLabel,
  className,
  ...data
}: VendorStoreInfoProps & { triggerLabel: string }) {
  const [open, setOpen] = useState(false);

  if (!hasVendorStoreInfo(data)) return null;

  return (
    <div className={cn("lg:hidden", className)}>
      <Sheet open={open} onOpenChange={setOpen}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm font-semibold transition-colors hover:bg-muted/60"
        >
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            {triggerLabel}
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180"
            aria-hidden="true"
          />
        </button>

        <SheetContent side="bottom" className="gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>{labels.heading}</SheetTitle>
          </SheetHeader>
          <div className="max-h-[70vh] overflow-y-auto p-4">
            <VendorStoreInfo
              {...data}
              labels={labels}
              hideHeading
              className="border-0 bg-transparent p-0"
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
