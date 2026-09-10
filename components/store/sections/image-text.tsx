import Link from "next/link";
import { ImageOff } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Locale } from "@/config/i18n.config";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  isExternalSectionHref,
  resolveSectionHref,
} from "./section-shell";

interface ImageTextProps {
  locale: Locale;
  imageSrc: string;
  imagePosition: "left" | "right";
  heading: string;
  /** TipTap HTML — sanitized on write and again here at render. */
  body: string;
  ctaLabel: string;
  href: string;
}

/** The split image + copy block (about blurbs, brand stories, USPs). */
export function ImageText({
  locale,
  imageSrc,
  imagePosition,
  heading,
  body,
  ctaLabel,
  href,
}: ImageTextProps) {
  const resolvedHref = href ? resolveSectionHref(locale, href) : "";
  const html = sanitizeHtml(body);

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div className="grid items-center gap-6 overflow-hidden rounded-md border border-border/70 bg-card lg:grid-cols-2 lg:gap-0">
          <div
            className={cn(
              "relative aspect-[4/3] bg-muted lg:aspect-auto lg:h-full lg:min-h-80",
              imagePosition === "right" && "lg:order-2",
            )}
          >
            {imageSrc ? (
              <AppImage
                src={imageSrc}
                alt={heading || ""}
                fill
                className="object-cover"
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center border-dashed text-muted-foreground">
                <ImageOff className="h-6 w-6" aria-hidden />
              </div>
            )}
          </div>

          <div className="space-y-4 p-6 sm:p-10">
            {heading ? (
              <h2 className="text-[length:var(--sec-title,1.5rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.875rem)]">
                {heading}
              </h2>
            ) : null}
            {html ? (
              <div
                className="rich-text-content max-w-none text-sm text-muted-foreground sm:text-base"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : null}
            {ctaLabel && resolvedHref ? (
              <Button asChild className="h-10 rounded-full px-6">
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
      </div>
    </section>
  );
}
