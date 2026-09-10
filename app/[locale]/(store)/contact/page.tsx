import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Clock3, Mail, MapPin, Phone } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { ContactForm } from "@/components/store/contact-form";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import {
  ContactRow,
  SocialIconLinks,
  buildSocialItems,
} from "@/components/store/store-contact-rows";
import { type ContactPageData } from "@/lib/site-config/content-pages-config";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

type StoreContactData = {
  storeName: string;
  email: string;
  phone: string;
  address: string;
  social: {
    facebookUrl?: string;
    twitterUrl?: string;
    instagramUrl?: string;
    youtubeUrl?: string;
    linkedinUrl?: string;
  };
};

// Resolved per request so the description names the store, not this app.
export async function generateMetadata(): Promise<Metadata> {
  const { storeName } = await getStorefrontSettings();

  return {
    title: "Contact Us",
    description: `Contact the ${storeName} team for order help, product questions, and store support.`,
  };
}

const fallbackStoreContact: StoreContactData = {
  storeName: DEFAULT_STORE_NAME,
  email: "support@storify.com",
  phone: "+1 (555) 010-2400",
  address: "221 Commerce Street, New York, NY 10013",
  social: {},
};

function hasCoordinates(page: ContactPageData) {
  return page.mapLatitude.trim() && page.mapLongitude.trim();
}

function resolveMapQuery(page: ContactPageData, contact: StoreContactData) {
  if (hasCoordinates(page)) {
    return `${page.mapLatitude.trim()},${page.mapLongitude.trim()}`;
  }

  return page.mapAddress.trim() || contact.address || contact.storeName;
}

function resolveMapEmbedUrl(page: ContactPageData, contact: StoreContactData) {
  const query = resolveMapQuery(page, contact);
  const encodedQuery = encodeURIComponent(query);

  if (
    page.mapProvider === "custom" &&
    /^https?:\/\//i.test(page.mapEmbedUrl.trim())
  ) {
    return page.mapEmbedUrl.trim();
  }

  if (page.mapProvider === "openstreetmap") {
    if (hasCoordinates(page)) {
      const lat = encodeURIComponent(page.mapLatitude.trim());
      const lon = encodeURIComponent(page.mapLongitude.trim());
      return `https://www.openstreetmap.org/export/embed.html?mlat=${lat}&mlon=${lon}&zoom=${page.mapZoom}`;
    }

    return `https://www.openstreetmap.org/search?query=${encodedQuery}`;
  }

  return `https://www.google.com/maps?q=${encodedQuery}&z=${page.mapZoom}&output=embed`;
}

function resolveMapExternalUrl(page: ContactPageData, contact: StoreContactData) {
  const query = resolveMapQuery(page, contact);
  const encodedQuery = encodeURIComponent(query);

  if (page.mapProvider === "openstreetmap") {
    if (hasCoordinates(page)) {
      const lat = encodeURIComponent(page.mapLatitude.trim());
      const lon = encodeURIComponent(page.mapLongitude.trim());
      return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${page.mapZoom}/${lat}/${lon}`;
    }

    return `https://www.openstreetmap.org/search?query=${encodedQuery}`;
  }

  if (
    page.mapProvider === "custom" &&
    /^https?:\/\//i.test(page.mapEmbedUrl.trim())
  ) {
    return page.mapEmbedUrl.trim();
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const {
    contentPages,
    social,
    storeAddress,
    storeEmail,
    storeName,
    storePhone,
  } = await getStorefrontSettings();
  const page = contentPages.contact;

  if (!page.visible) {
    notFound();
  }

  const contact: StoreContactData = {
    storeName: storeName || fallbackStoreContact.storeName,
    email: storeEmail || fallbackStoreContact.email,
    phone: storePhone || fallbackStoreContact.phone,
    address: storeAddress || fallbackStoreContact.address,
    social,
  };

  const mapEmbedUrl = resolveMapEmbedUrl(page, contact);
  const mapExternalUrl = resolveMapExternalUrl(page, contact);
  const socialItems = page.showSocialLinks
    ? buildSocialItems(contact.social)
    : [];

  return (
    <div className="bg-background">
      {/* Above the hero rather than over it: the trail is chrome, and laying it
          on a photograph costs it the contrast it needs to stay readable. */}
      <div className="container mx-auto px-4 pt-6">
        <StoreBreadcrumb locale={locale} items={[{ label: page.title }]} />
      </div>

      <section className="relative isolate overflow-hidden">
        <div className="relative min-h-[300px] md:min-h-[380px]">
          <Image
            src={page.heroImageUrl || "/contact-hero-storify.png"}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-slate-950/68" />
          <div className="absolute inset-0 bg-primary/20 mix-blend-multiply" />
          <div className="container relative z-10 mx-auto flex min-h-[300px] max-w-3xl flex-col items-center justify-center px-4 text-center text-white md:min-h-[380px]">
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              {page.title}
            </h1>
            <p className="mt-4 text-base leading-7 text-white/86 md:text-lg">
              {page.description}
            </p>
          </div>
        </div>
      </section>

      <section className="relative z-20 -mt-10 pb-12 md:-mt-16 md:pb-16">
        <div className="container mx-auto px-4">
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-xl shadow-slate-950/10">
            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
              <div className="bg-muted/50 p-6 md:p-8 lg:p-10">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {page.getInTouchTitle}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {page.getInTouchDescription}
                </p>

                <div className="mt-8 space-y-5">
                  <ContactRow
                    icon={MapPin}
                    title={page.headOfficeTitle}
                    value={contact.address}
                  />
                  <ContactRow
                    icon={Mail}
                    title={page.emailTitle}
                    value={contact.email}
                    href={`mailto:${contact.email}`}
                  />
                  <ContactRow
                    icon={Phone}
                    title={page.phoneTitle}
                    value={contact.phone}
                    href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                  />
                  <ContactRow
                    icon={Clock3}
                    title={page.hoursTitle}
                    value={page.supportHours}
                  />
                </div>

                {socialItems.length > 0 ? (
                  <div className="mt-8 border-t border-border/70 pt-6">
                    <p className="text-sm font-semibold">Follow us</p>
                    <SocialIconLinks items={socialItems} className="mt-3" />
                  </div>
                ) : null}
              </div>

              <div className="p-6 md:p-8 lg:p-10">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {page.formTitle}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {page.formDescription}
                </p>
                <div className="mt-6">
                  <ContactForm />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {page.showMap ? (
        <section className="pb-14 md:pb-20">
          <div className="container mx-auto px-4">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {page.mapTitle}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  {page.mapDescription}
                </p>
              </div>
              {page.mapButtonLabel ? (
                <a
                  href={mapExternalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {page.mapButtonLabel}
                </a>
              ) : null}
            </div>
            <div className="overflow-hidden rounded-lg border border-border/70 bg-muted">
              <iframe
                title={`${contact.storeName} location map`}
                src={mapEmbedUrl}
                className="w-full border-0"
                style={{ height: `${page.mapHeight}px` }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
