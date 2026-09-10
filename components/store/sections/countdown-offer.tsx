import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { CountdownOfferView } from "./countdown-offer-view";
import {
  isExternalSectionHref,
  resolveSectionHref,
} from "./section-shell";

interface CountdownOfferProps {
  locale: Locale;
  heading: string;
  subheading: string;
  endsAt: string;
  ctaLabel: string;
  href: string;
  imageSrc: string;
  /** Labelled outline for the admin preview; null on the live storefront. */
  emptyState?: React.ReactNode;
}

/**
 * Server half of the deadline strip: resolves labels and the CTA href, then
 * hands off to the client view, which owns the ticking and the "already
 * expired" decision (the clock is not readable in a server render).
 */
export async function CountdownOffer({
  locale,
  heading,
  subheading,
  endsAt,
  ctaLabel,
  href,
  imageSrc,
  emptyState = null,
}: CountdownOfferProps) {
  // Live storefronts stay silent without a deadline; the admin preview
  // shows which field is missing.
  if (!endsAt || Number.isNaN(Date.parse(endsAt))) return emptyState;

  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <CountdownOfferView
      heading={heading}
      subheading={subheading}
      endsAt={endsAt}
      ctaLabel={ctaLabel}
      href={href ? resolveSectionHref(locale, href) : ""}
      external={isExternalSectionHref(href)}
      imageSrc={imageSrc}
      labels={{
        days: t("countdownDays"),
        hours: t("countdownHours"),
        minutes: t("countdownMinutes"),
        seconds: t("countdownSeconds"),
      }}
    />
  );
}
