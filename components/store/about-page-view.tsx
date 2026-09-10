import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  CreditCard,
  ImageOff,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  RotateCcw,
  Search,
  ShieldCheck,
  Star,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollRail } from "@/components/store/scroll-rail";
import { SERVICE_BENEFIT_ICON_COMPONENTS } from "@/components/store/sections/service-benefits";
import type { TestimonialEntry } from "@/components/store/sections/testimonials";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import {
  ContactRow,
  SocialIconLinks,
  buildSocialItems,
  type StoreSocialLinks,
} from "@/components/store/store-contact-rows";
import { sanitizeHtml } from "@/lib/sanitize";
import type {
  AboutPageData,
  AboutStep,
} from "@/lib/site-config/content-pages-config";
import type { ResolvedAboutStat } from "@/lib/storefront/about-stats";
import { cn } from "@/lib/utils";

/** Placeholders the admin copy may carry; filled once, here, before render. */
interface AboutPlaceholders {
  storeName: string;
  returnWindow: string;
}

export function fillAboutPlaceholders(
  value: string,
  vars: AboutPlaceholders,
): string {
  return value
    .replace(/\{storeName\}/g, vars.storeName)
    .replace(/\{returnWindow\}/g, vars.returnWindow);
}

interface AboutContactData {
  address: string;
  email: string;
  phone: string;
  supportHours: string;
  social: StoreSocialLinks;
  labels: { address: string; email: string; phone: string; hours: string };
}

interface AboutPageViewProps {
  locale: string;
  page: AboutPageData;
  placeholders: AboutPlaceholders;
  isMultiVendorEnabled: boolean;
  stats: ResolvedAboutStat[];
  /** e.g. "September 2026" — the month the counts were rendered. */
  statsDateLabel: string;
  testimonials: TestimonialEntry[];
  verifiedCustomerLabel: string;
  contact: AboutContactData;
  contactCtaLabel: string;
}

// Index-based, like the Returns page's step icons: the copy is the merchant's,
// the pictograms stay the design's.
const SHOPPER_STEP_ICONS: LucideIcon[] = [Search, CreditCard, PackageCheck];
const SELLER_STEP_ICONS: LucideIcon[] = [ClipboardCheck, BadgeCheck, Wallet];
const PROTECTION_ICONS: LucideIcon[] = [ShieldCheck, RotateCcw, BadgeCheck];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The About Us page: nine sections in the order shoppers look for them —
 * what the store is, how big, how it works, why, its story, its people,
 * proof, contact, and one closing action. Every optional section hides
 * itself when it has nothing to show; the page never renders an empty box.
 */
export function AboutPageView({
  locale,
  page,
  placeholders,
  isMultiVendorEnabled,
  stats,
  statsDateLabel,
  testimonials,
  verifiedCustomerLabel,
  contact,
  contactCtaLabel,
}: AboutPageViewProps) {
  const fill = (value: string) => fillAboutPlaceholders(value, placeholders);

  const showStats = page.showStats && stats.length >= 2;
  const heroStats = page.showStats ? stats.slice(0, 3) : [];
  const showHeroImage = page.heroImageUrl.trim().length > 0;
  const showHeroAside = showHeroImage || heroStats.length >= 2;

  const shopperSteps = page.shopperSteps.filter(
    (step) => step.title || step.description,
  );
  const sellerSteps =
    isMultiVendorEnabled && page.showSellerSteps
      ? page.sellerSteps.filter((step) => step.title || step.description)
      : [];
  const protectionItems = page.protectionItems.filter(
    (item) => item.title || item.text,
  );
  const showHowItWorks = shopperSteps.length > 0 || sellerSteps.length > 0;

  const values = page.values.filter((item) => item.title || item.text);
  const storyHtml = sanitizeHtml(fill(page.storyBody));
  const milestones = page.milestones.filter((item) => item.year || item.text);
  const members = page.showTeam
    ? page.members.filter((member) => member.name)
    : [];
  const showTestimonials = page.showTestimonials && testimonials.length > 0;
  const hasContactData = Boolean(
    contact.address || contact.email || contact.phone,
  );
  const showContact = page.showContact && hasContactData;
  const socialItems = buildSocialItems(contact.social);

  const secondaryHref = isMultiVendorEnabled
    ? `/${locale}/become-vendor`
    : `/${locale}/contact`;
  const secondaryLabel = isMultiVendorEnabled
    ? fill(page.secondaryCtaLabel)
    : contactCtaLabel;

  return (
    <main className="bg-background">
      {/* 1 · Hero */}
      <section className="border-b bg-muted">
        <div
          className={cn(
            "container mx-auto grid gap-10 px-4 pb-12 pt-8 lg:pb-16 lg:pt-10",
            showHeroAside && "lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end",
          )}
        >
          <div className="max-w-3xl">
            <StoreBreadcrumb locale={locale} items={[{ label: page.title }]} />

            {page.eyebrow ? (
              <Badge variant="outline" className="mb-4 gap-2 rounded-md">
                <Building2 className="h-3.5 w-3.5" aria-hidden />
                {fill(page.eyebrow)}
              </Badge>
            ) : null}
            <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-5xl">
              {fill(page.headline) || fill(page.title)}
            </h1>
            {page.description ? (
              <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                {fill(page.description)}
              </p>
            ) : null}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              {page.primaryCtaLabel ? (
                <Button asChild size="lg">
                  <Link href={`/${locale}/products`}>
                    {fill(page.primaryCtaLabel)}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </Button>
              ) : null}
              {secondaryLabel ? (
                <Button asChild size="lg" variant="outline">
                  <Link href={secondaryHref}>{secondaryLabel}</Link>
                </Button>
              ) : null}
            </div>
          </div>

          {showHeroImage ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-card">
              <AppImage
                src={page.heroImageUrl}
                alt=""
                fill
                loading="eager"
                fetchPriority="high"
                sizes="(min-width: 1024px) 420px, 100vw"
                className="object-cover"
              />
            </div>
          ) : heroStats.length >= 2 ? (
            <dl className="grid gap-3 rounded-lg border bg-card p-5 shadow-sm">
              {heroStats.map((stat, index) => (
                <div
                  key={stat.key}
                  className={cn(
                    "flex items-baseline justify-between gap-4",
                    index > 0 && "border-t pt-3",
                  )}
                >
                  <dt className="text-sm text-muted-foreground">{stat.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      {/* 2 · Numbers */}
      {showStats ? (
        <section className="py-12 md:py-14">
          <div className="container mx-auto px-4">
            <dl
              className={cn(
                "grid gap-4",
                stats.length === 2 && "sm:grid-cols-2",
                stats.length === 3 && "sm:grid-cols-3",
                stats.length >= 4 && "sm:grid-cols-2 lg:grid-cols-4",
              )}
            >
              {stats.map((stat) => (
                <div
                  key={stat.key}
                  className="flex flex-col gap-1 rounded-lg border bg-card p-5"
                >
                  <dd className="order-1 text-3xl font-semibold tracking-tight tabular-nums">
                    {stat.value}
                  </dd>
                  <dt className="order-2 text-sm text-muted-foreground">
                    {stat.label}
                  </dt>
                </div>
              ))}
            </dl>
            {page.statsFootnote || statsDateLabel ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {[fill(page.statsFootnote), statsDateLabel]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 3 · How it works */}
      {showHowItWorks ? (
        <section className="border-y bg-muted py-12 md:py-16">
          <div className="container mx-auto px-4">
            <SectionIntro
              title={fill(page.howItWorksTitle)}
              description={fill(page.howItWorksDescription)}
            />

            <div
              className={cn(
                "mt-8 grid gap-6",
                sellerSteps.length > 0 && "lg:grid-cols-2",
              )}
            >
              {shopperSteps.length > 0 ? (
                <StepCard
                  title={fill(page.shopperStepsTitle)}
                  steps={shopperSteps}
                  icons={SHOPPER_STEP_ICONS}
                  fill={fill}
                />
              ) : null}
              {sellerSteps.length > 0 ? (
                <StepCard
                  title={fill(page.sellerStepsTitle)}
                  steps={sellerSteps}
                  icons={SELLER_STEP_ICONS}
                  fill={fill}
                  footer={
                    page.sellerCtaLabel ? (
                      <Link
                        href={`/${locale}/become-vendor`}
                        className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        {fill(page.sellerCtaLabel)}
                        <ArrowRight
                          className="h-3.5 w-3.5 rtl:rotate-180"
                          aria-hidden
                        />
                      </Link>
                    ) : null
                  }
                />
              ) : null}
            </div>

            {protectionItems.length > 0 ? (
              <div
                className={cn(
                  "mt-5 grid gap-6 rounded-lg border bg-card p-6 md:p-7",
                  protectionItems.length === 2 && "md:grid-cols-2",
                  protectionItems.length >= 3 && "md:grid-cols-3",
                )}
              >
                {protectionItems.map((item, index) => {
                  const Icon = PROTECTION_ICONS[index] ?? CheckCircle2;
                  return (
                    <div key={item.id} className="flex gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-4.5 w-4.5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        {item.title ? (
                          <h3 className="font-semibold">{fill(item.title)}</h3>
                        ) : null}
                        {item.text ? (
                          <p className="text-sm leading-6 text-muted-foreground">
                            {fill(item.text)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4 · Mission & values */}
      {values.length > 0 || page.missionStatement ? (
        <section className="py-12 md:py-16">
          <div className="container mx-auto px-4">
            <SectionIntro
              title={fill(page.valuesTitle)}
              description={fill(page.missionStatement)}
            />
            {values.length > 0 ? (
              <div
                className={cn(
                  "mt-8 grid gap-6 rounded-lg border bg-card p-6",
                  values.length === 2 && "sm:grid-cols-2",
                  values.length === 3 && "sm:grid-cols-3",
                  values.length === 4 && "sm:grid-cols-2 lg:grid-cols-4",
                  values.length >= 5 && "sm:grid-cols-2 lg:grid-cols-3",
                )}
              >
                {values.map((item) => {
                  const Icon =
                    SERVICE_BENEFIT_ICON_COMPONENTS[item.icon] ?? ShieldCheck;
                  return (
                    <div key={item.id} className="flex gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        {item.title ? (
                          <h3 className="font-semibold">{fill(item.title)}</h3>
                        ) : null}
                        {item.text ? (
                          <p className="text-sm leading-6 text-muted-foreground">
                            {fill(item.text)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 5 · Story */}
      {storyHtml ? (
        <section className="border-y bg-muted py-12 md:py-16">
          <div
            className={cn(
              "container mx-auto grid gap-10 px-4",
              milestones.length > 0 &&
                "lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start",
            )}
          >
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                {fill(page.storyTitle)}
              </h2>
              <div
                className="rich-text-content mt-4 max-w-2xl text-base leading-7 text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: storyHtml }}
              />
            </div>
            {milestones.length > 0 ? (
              <div className="rounded-lg border bg-card p-6 md:p-7">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {fill(page.milestonesTitle)}
                </p>
                <ol className="mt-4">
                  {milestones.map((item, index) => (
                    <li
                      key={item.id}
                      className={cn(
                        "grid grid-cols-[64px_minmax(0,1fr)] gap-4 py-4 text-sm",
                        index > 0 && "border-t",
                        index === 0 && "pt-0",
                        index === milestones.length - 1 && "pb-0",
                      )}
                    >
                      <span className="font-semibold text-primary tabular-nums">
                        {item.year}
                      </span>
                      <span className="text-muted-foreground">{fill(item.text)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 6 · Team */}
      {members.length > 0 ? (
        <section className="py-12 md:py-16">
          <div className="container mx-auto px-4">
            <SectionIntro
              title={fill(page.teamTitle)}
              description={fill(page.teamDescription)}
            />
          </div>
          <ScrollRail className="mt-8 px-4 pb-1 lg:container lg:mx-auto lg:overflow-visible">
            <div className="flex gap-4 lg:grid lg:grid-cols-4">
              {members.map((member) => {
                const heading = member.linkUrl ? (
                  <a
                    href={member.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary"
                  >
                    {member.name}
                  </a>
                ) : (
                  member.name
                );
                return (
                  <div
                    key={member.id}
                    className="flex w-56 shrink-0 flex-col items-center rounded-lg border bg-card p-6 text-center lg:w-auto"
                  >
                    <Avatar className="mb-3 size-20">
                      {member.imageUrl ? (
                        <AvatarImage src={member.imageUrl} alt="" />
                      ) : null}
                      <AvatarFallback className="text-xl font-semibold text-muted-foreground">
                        {initials(member.name) || <ImageOff className="h-5 w-5" aria-hidden />}
                      </AvatarFallback>
                    </Avatar>
                    <h3 className="font-semibold">{heading}</h3>
                    {member.role ? (
                      <p className="text-sm text-muted-foreground">{member.role}</p>
                    ) : null}
                    {member.bio ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {fill(member.bio)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ScrollRail>
        </section>
      ) : null}

      {/* 7 · Social proof */}
      {showTestimonials ? (
        <section className="border-y bg-muted py-12 md:py-16">
          <div className="container mx-auto px-4">
            <SectionIntro
              title={fill(page.testimonialsTitle)}
              description={fill(page.testimonialsDescription)}
            />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {testimonials.map((entry) => (
                <figure
                  key={entry.id}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-5"
                >
                  <div
                    className="flex items-center gap-0.5"
                    aria-label={`${entry.rating}/5`}
                  >
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star
                        key={index}
                        className={cn(
                          "h-4 w-4",
                          index < entry.rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/30",
                        )}
                        aria-hidden
                      />
                    ))}
                  </div>
                  <blockquote className="text-sm leading-relaxed text-muted-foreground">
                    {entry.title ? (
                      <span className="mb-1 block font-semibold text-foreground">
                        {entry.title}
                      </span>
                    ) : null}
                    <span className="line-clamp-4">{entry.comment}</span>
                  </blockquote>
                  <figcaption className="mt-auto text-xs font-medium text-foreground">
                    {entry.reviewerName || verifiedCustomerLabel}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 8 · Contact & location */}
      {showContact ? (
        <section className="py-12 md:py-16">
          <div className="container mx-auto px-4">
            <div className="grid gap-8 rounded-lg border bg-card p-6 md:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {fill(page.contactTitle)}
                </h2>
                {page.contactDescription ? (
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {fill(page.contactDescription)}
                  </p>
                ) : null}
                <div className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-x-10">
                  {contact.address ? (
                    <ContactRow
                      icon={MapPin}
                      title={contact.labels.address}
                      value={contact.address}
                    />
                  ) : null}
                  {contact.email ? (
                    <ContactRow
                      icon={Mail}
                      title={contact.labels.email}
                      value={contact.email}
                      href={`mailto:${contact.email}`}
                    />
                  ) : null}
                  {contact.phone ? (
                    <ContactRow
                      icon={Phone}
                      title={contact.labels.phone}
                      value={contact.phone}
                      href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                    />
                  ) : null}
                  {contact.supportHours ? (
                    <ContactRow
                      icon={Clock3}
                      title={contact.labels.hours}
                      value={contact.supportHours}
                    />
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-4 lg:items-end">
                <Button asChild variant="outline">
                  <Link href={`/${locale}/contact`}>
                    {contactCtaLabel}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </Button>
                <SocialIconLinks items={socialItems} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* 9 · Closing call to action */}
      <section className="bg-primary py-16 text-primary-foreground">
        <div className="container mx-auto flex flex-col items-center px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight">{fill(page.ctaTitle)}</h2>
          {page.ctaDescription ? (
            <p className="mt-3 max-w-2xl opacity-90">{fill(page.ctaDescription)}</p>
          ) : null}
          <div className="mt-7 flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            {page.ctaPrimaryLabel ? (
              // Not `variant="secondary"`: that token is the Branding "secondary"
              // colour (violet by default), which would clash with this band.
              <Button
                asChild
                size="lg"
                className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
              >
                <Link href={`/${locale}/products`}>
                  {fill(page.ctaPrimaryLabel)}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </Link>
              </Button>
            ) : null}
            {secondaryLabel ? (
              <Link
                href={secondaryHref}
                className="text-sm font-medium underline underline-offset-4 hover:opacity-90"
              >
                {isMultiVendorEnabled ? fill(page.ctaSecondaryLabel) : contactCtaLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionIntro({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  if (!title && !description) return null;
  return (
    <div className="max-w-2xl">
      {title ? (
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="mt-3 text-base leading-7 text-muted-foreground md:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function StepCard({
  title,
  steps,
  icons,
  fill,
  footer,
}: {
  title: string;
  steps: AboutStep[];
  icons: LucideIcon[];
  fill: (value: string) => string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-6 md:p-7">
      {title ? <h3 className="font-semibold">{title}</h3> : null}
      <ol className="mt-5 grid gap-5">
        {steps.map((step, index) => {
          const Icon = icons[index] ?? CheckCircle2;
          return (
            <li
              key={step.id}
              className="grid grid-cols-[40px_minmax(0,1fr)] gap-4"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <span className="block text-xs font-medium text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {step.title ? (
                  <p className="font-semibold">{fill(step.title)}</p>
                ) : null}
                {step.description ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {fill(step.description)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {footer}
    </div>
  );
}
