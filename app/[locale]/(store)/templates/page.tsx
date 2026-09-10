import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowRight, MonitorSmartphone } from "lucide-react";
import { themePreviewSrc } from "@/lib/storefront/themes/preview";
import { THEME_MANIFESTS } from "@/lib/storefront/themes/registry";
import { getDemoTemplateUrls } from "@/lib/storefront/demo-links";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  if (process.env.DEMO_TEMPLATES !== "1") return {};
  return {
    title: "Store Templates",
    robots: { index: false, follow: false },
  };
}

/**
 * The template comparison gallery — the page the marketplace listing links
 * to. DEMO DEPLOYMENTS only (DEMO_TEMPLATES=1, otherwise 404): like the
 * floating pill this is vendor marketing chrome on our own demo host, so
 * its copy is deliberately English-only and stays out of the locale files.
 * A merchant's store never has this route, so a landing/quick page named
 * "templates" is only shadowed on the demo host itself.
 *
 * Every template demo is its own deployment (subdomain + database with its
 * own sample catalogue), so "View live demo" leaves for that host — except
 * the current deployment's template, which links back to its own home. A
 * template DEMO_TEMPLATE_URLS does not name would be a dead card, so only
 * the current deployment lists without one.
 */
export default async function TemplatesGalleryPage({ params }: PageProps) {
  if (process.env.DEMO_TEMPLATES !== "1") notFound();

  const { locale } = await params;
  setRequestLocale(locale);

  // Request-deduped — rides along with the (store) layout's read.
  const { theme } = await getStorefrontSettings();
  const demoUrls = getDemoTemplateUrls();

  const templates = THEME_MANIFESTS.filter(
    (manifest) =>
      manifest.status === "stable" &&
      (manifest.id === theme.id || demoUrls[manifest.id]),
  );

  return (
    <div className="container mx-auto px-4 py-12 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">
          One engine, many storefronts
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Pick a template, keep your catalog
        </h1>
        <p className="mt-3 text-muted-foreground">
          Every template restyles the whole storefront — home, product pages,
          header and footer. Switching later replaces the layout only: your
          products, orders and settings stay exactly where they are.
        </p>
      </div>

      <div className="mt-12 space-y-16">
        {templates.map((manifest, index) => (
          <section
            key={manifest.id}
            className="grid items-center gap-8 lg:grid-cols-2"
          >
            <div
              className={
                index % 2 === 1 ? "lg:order-2" : undefined
              }
            >
              {/* Desktop capture with the mobile capture overlapping it —
                  both bundled with the template. */}
              <div className="relative">
                {manifest.preview ? (
                  <>
                    <span className="relative block aspect-[4/3] overflow-hidden rounded-xl border border-border shadow-sm">
                      <Image
                        src={themePreviewSrc(manifest, "card")!}
                        alt={`${manifest.name} on desktop`}
                        fill
                        unoptimized
                        sizes="(min-width: 1024px) 50vw, 100vw"
                        className="object-cover object-top"
                      />
                    </span>
                    <span className="absolute -bottom-6 right-4 block w-[22%] min-w-[96px] overflow-hidden rounded-lg border border-border bg-background shadow-xl">
                      <Image
                        src={themePreviewSrc(manifest, "mobile")!}
                        alt={`${manifest.name} on mobile`}
                        width={390}
                        height={844}
                        unoptimized
                        className="h-auto w-full"
                      />
                    </span>
                  </>
                ) : (
                  <span
                    className={`block aspect-[4/3] rounded-xl bg-gradient-to-br ${manifest.accent}`}
                  />
                )}
              </div>
            </div>

            <div className={index % 2 === 1 ? "lg:order-1" : undefined}>
              <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <MonitorSmartphone className="h-4 w-4" />
                Desktop &amp; mobile
              </p>
              <h2 className="mt-2 text-2xl font-bold">{manifest.name}</h2>
              <p className="mt-2 max-w-prose text-muted-foreground">
                {manifest.description}
              </p>
              <div className="mt-6">
                {/* Another template's demo opens in a new tab; the current
                    deployment's own just goes home. */}
                <a
                  href={
                    manifest.id === theme.id
                      ? `/${locale}`
                      : `${demoUrls[manifest.id]}/${locale}`
                  }
                  {...(manifest.id === theme.id
                    ? {}
                    : { target: "_blank", rel: "noopener noreferrer" })}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  View live demo
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
