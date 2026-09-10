import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { type Locale } from "@/config/i18n.config";

interface HomeBecomeVendorSectionProps {
  locale: Locale;
  title: string;
  subtitle: string;
  buttonLabel: string;
  buttonHref: string;
  imageSrc: string;
}

function resolveHref(locale: Locale, href: string): string {
  if (!href) return `/${locale}`;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) {
    if (href === `/${locale}` || href.startsWith(`/${locale}/`)) return href;
    return `/${locale}${href}`;
  }
  return `/${locale}/${href}`;
}

export function HomeBecomeVendorSection({
  locale,
  title,
  subtitle,
  buttonLabel,
  buttonHref,
  imageSrc,
}: HomeBecomeVendorSectionProps) {
  const href = resolveHref(locale, buttonHref);

  return (
    <section className="py-6 lg:py-10">
      <div className="container mx-auto px-4">
        <div
          className="relative overflow-hidden rounded-lg border bg-muted/40 bg-[radial-gradient(circle,rgba(15,23,42,0.08)_1px,transparent_1px)] bg-size-[22px_22px] dark:bg-card dark:bg-[radial-gradient(circle,rgba(148,163,184,0.1)_1px,transparent_1px)]"
        >
          <div className="relative flex flex-col items-center gap-6 p-6 text-center sm:p-8 lg:grid lg:grid-cols-[1fr_1.2fr] lg:items-center lg:gap-8 lg:p-14 lg:text-left">
            <div className="order-1 space-y-4 sm:space-y-5 lg:order-0">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-5xl">
                {title}
              </h2>

              <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base lg:mx-0">
                {subtitle}
              </p>

              <div className="flex justify-center lg:justify-start">
                <Button
                  size="lg"
                  asChild
                  className="h-11 rounded-full bg-foreground px-6 text-sm font-medium text-background shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-foreground/90 sm:h-12 sm:px-7 sm:text-base"
                >
                  <Link href={href} className="whitespace-nowrap">
                    {buttonLabel}
                  </Link>
                </Button>
              </div>
            </div>

            {imageSrc ? (
              <div className="relative order-2 -mx-6 -mb-6 min-w-0 overflow-hidden sm:-mx-8 sm:-mb-8 lg:order-0 lg:mx-0 lg:-mr-14 lg:-mb-14 lg:flex lg:h-auto lg:items-end lg:justify-end lg:self-end lg:overflow-visible">
                <AppImage
                  src={imageSrc}
                  alt={title}
                  width={720}
                  height={500}
                  className="h-64 w-full max-w-full object-cover object-center sm:h-80 lg:h-auto lg:max-h-160 lg:w-full lg:object-contain lg:object-bottom"
                  sizes="(min-width: 1024px) 720px, 100vw"
                  priority={false}
                />
              </div>
            ) : (
              <div aria-hidden className="hidden lg:block" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
