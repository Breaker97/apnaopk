import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { ScrollRail } from "@/components/store/scroll-rail";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Locale } from "@/config/i18n.config";
import { type HomeFromInstagramItem } from "@/lib/site-config/home-page-config";

interface HomeFromInstagramProps {
  locale: Locale;
  className?: string;
  title?: string;
  items?: HomeFromInstagramItem[];
}

function buildHref(locale: Locale, href: string): string {
  if (!href) return `/${locale}`;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith(`/${locale}/`) || href === `/${locale}`) return href;
  return `/${locale}${href.startsWith("/") ? href : `/${href}`}`;
}

function isExternalHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}

export function HomeFromInstagram({
  locale,
  className,
  title,
  items,
}: HomeFromInstagramProps) {
  const sourceItems = items && items.length > 0 ? items : Array.from({ length: 5 }, () => ({ imageSrc: "", href: "" }));

  return (
    <section className={cn("py-5 lg:py-8", className)}>
      <div className="container mx-auto px-4">
        <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
          {title || "From Instagram"}
        </h2>
        {/* Five squares in two columns leave a lone tile on a third row, which
            reads as a failed load rather than a design — and any other count
            leaves its own hole, since the strip's length is the merchant's.
            Below md it is a rail instead: no orphan at any count, a third of
            the height, and the fade says it continues. The designed
            five-across returns at md, where five tiles fit exactly. */}
        <ScrollRail className="mt-4 flex snap-x gap-2.5 scroll-px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-5 md:gap-4 md:overflow-x-visible md:pb-0 [&::-webkit-scrollbar]:hidden">
          {sourceItems.map((item, index) => {
            const href = buildHref(locale, item.href);
            const external = isExternalHref(item.href);

            return (
              <Link
                key={index}
                href={href}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="group relative isolate aspect-square w-[38%] shrink-0 snap-start overflow-hidden rounded-sm border border-dashed border-border bg-muted/40 sm:w-[30%] sm:rounded-md md:w-auto"
              >
                {item.imageSrc ? (
                  <AppImage
                    src={item.imageSrc}
                    alt=""
                    fill
                    sizes="(max-width: 767px) 40vw, 20vw"
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                    aria-hidden="true"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center">
                    <ImageOff className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                )}
              </Link>
            );
          })}
        </ScrollRail>
      </div>
    </section>
  );
}
