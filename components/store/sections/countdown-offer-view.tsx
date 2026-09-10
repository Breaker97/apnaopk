"use client";

import Link from "next/link";
import { useState } from "react";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "./countdown-timer";

interface CountdownOfferViewProps {
  heading: string;
  subheading: string;
  endsAt: string;
  ctaLabel: string;
  /** Already locale-resolved by the server half. */
  href: string;
  external: boolean;
  imageSrc: string;
  labels: { days: string; hours: string; minutes: string; seconds: string };
}

/**
 * Client half of the countdown offer. Owns the expiry decision — captured
 * once per mount (the react-hooks/purity pattern used elsewhere): an offer
 * that expired before the visit renders nothing; one expiring mid-visit
 * clamps at zero until the next navigation.
 */
export function CountdownOfferView({
  heading,
  subheading,
  endsAt,
  ctaLabel,
  href,
  external,
  imageSrc,
  labels,
}: CountdownOfferViewProps) {
  const [expiredAtMount] = useState(() => Date.parse(endsAt) <= Date.now());
  if (expiredAtMount) return null;

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div className="relative overflow-hidden rounded-md border border-border/70 bg-card">
          {imageSrc ? (
            <>
              <AppImage
                src={imageSrc}
                alt=""
                fill
                className="object-cover"
                sizes="(min-width: 1360px) 1328px, 100vw"
              />
              <div className="absolute inset-0 bg-black/50" aria-hidden />
            </>
          ) : null}

          <div
            className={
              imageSrc
                ? "relative flex flex-col items-start justify-between gap-6 p-6 text-white sm:flex-row sm:items-center sm:p-10"
                : "relative flex flex-col items-start justify-between gap-6 p-6 sm:flex-row sm:items-center sm:p-10"
            }
          >
            <div className="max-w-xl space-y-2">
              {heading ? (
                <h2 className="text-[length:var(--sec-title,1.5rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.875rem)]">
                  {heading}
                </h2>
              ) : null}
              {subheading ? (
                <p
                  className={
                    imageSrc
                      ? "text-sm text-white/85 sm:text-base"
                      : "text-sm text-muted-foreground sm:text-base"
                  }
                >
                  {subheading}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col items-start gap-4 sm:items-end">
              <CountdownTimer endsAt={endsAt} labels={labels} />
              {ctaLabel && href ? (
                <Button asChild className="h-10 rounded-full px-6">
                  <Link
                    href={href}
                    {...(external
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
      </div>
    </section>
  );
}
