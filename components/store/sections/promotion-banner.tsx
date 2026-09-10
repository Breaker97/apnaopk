import Link from "next/link";
import { ImageOff } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Locale } from "@/config/i18n.config";
import {
  isExternalSectionHref,
  resolveSectionHref,
} from "./section-shell";

interface PromotionBannerProps {
  locale: Locale;
  imageSrc: string;
  heading: string;
  subheading: string;
  ctaLabel: string;
  href: string;
  fullWidth: boolean;
}

/** A single promotional banner with optional overlaid copy and CTA. */
export function PromotionBanner({
  locale,
  imageSrc,
  heading,
  subheading,
  ctaLabel,
  href,
  fullWidth,
}: PromotionBannerProps) {
  const resolvedHref = href ? resolveSectionHref(locale, href) : "";
  const hasCopy = Boolean(heading || subheading || ctaLabel);

  const banner = (
    <div
      className={cn(
        "relative overflow-hidden bg-muted",
        fullWidth ? "rounded-none" : "rounded-xl",
        "aspect-[16/7] sm:aspect-[16/5]",
      )}
    >
      {imageSrc ? (
        <AppImage
          src={imageSrc}
          alt={heading || ""}
          fill
          className="object-cover"
          sizes={fullWidth ? "100vw" : "(min-width: 1360px) 1328px, 100vw"}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center border border-dashed border-border text-muted-foreground">
          <ImageOff className="h-6 w-6" aria-hidden />
        </div>
      )}

      {hasCopy ? (
        <div className="absolute inset-0 flex items-center bg-gradient-to-r from-black/55 via-black/25 to-transparent">
          <div className="max-w-xl space-y-3 px-6 py-6 text-white sm:px-10">
            {heading ? (
              <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
                {heading}
              </h2>
            ) : null}
            {subheading ? (
              <p className="text-sm text-white/85 sm:text-base">{subheading}</p>
            ) : null}
            {ctaLabel && resolvedHref ? (
              <Button
                asChild
                className="mt-1 h-10 rounded-full bg-white px-6 text-sm font-medium text-black hover:bg-white/90"
              >
                <Link
                  href={resolvedHref}
                  {...(isExternalSectionHref(href)
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {ctaLabel}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  // The whole banner is the link only when there is no dedicated CTA button
  // competing for the click.
  const content =
    resolvedHref && !ctaLabel ? (
      <Link
        href={resolvedHref}
        {...(isExternalSectionHref(href)
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
        className="block"
      >
        {banner}
      </Link>
    ) : (
      banner
    );

  return (
    <section className="py-5 lg:py-8">
      {fullWidth ? (
        content
      ) : (
        <div className="container mx-auto px-4">{content}</div>
      )}
    </section>
  );
}
