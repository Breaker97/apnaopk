import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";

export interface BlogArticleCardData {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  image: string;
  imageAlt: string;
  authorName: string;
  authorImage: string;
  publishedAt: string;
}

function formatDate(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BlogArticleCard({
  article,
  locale,
  className,
}: {
  article: BlogArticleCardData;
  locale: Locale;
  className?: string;
}) {
  const href = `/${locale}/blog/${article.slug}`;

  return (
    <article
      className={cn(
        // h-full: a row of cards stretches to the tallest, so every footer
        // lands on the same baseline whatever the excerpt length.
        "flex h-full flex-col overflow-hidden rounded-lg border border-border/80 bg-card transition-all hover:shadow-md sm:min-h-87.5",
        className,
      )}
    >
      <Link href={href} className="block aspect-video overflow-hidden bg-muted">
        {article.image ? (
          <AppImage
            src={article.image}
            alt={article.imageAlt || article.title}
            width={640}
            height={400}
            className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
            No image
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-3.5 sm:p-5 lg:p-6">
        <Link href={href}>
          <h3 className="mb-2 line-clamp-2 text-sm font-bold leading-snug text-foreground transition-colors hover:text-primary sm:mb-4 sm:text-[19px]">
            {article.title}
          </h3>
        </Link>
        {article.excerpt ? (
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground sm:line-clamp-3 sm:text-sm sm:leading-6">
            {article.excerpt}
          </p>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-4 sm:gap-3 sm:pt-7">
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted sm:h-10 sm:w-10">
              {article.authorImage ? (
                <AppImage
                  src={article.authorImage}
                  alt={article.authorName}
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs font-semibold text-muted-foreground">
                  {article.authorName.slice(0, 1)}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground sm:text-sm">
                {article.authorName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                {formatDate(article.publishedAt)}
              </p>
            </div>
          </div>
          <Link
            href={href}
            // data-slot="button" is the Theme-settings Button-style hook
            // (globals.css) — raw CTAs opt in so "Square"/"Rounded" reshape
            // them like every real Button.
            data-slot="button"
            className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-foreground/80 bg-background px-3 text-[11px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary sm:h-9 sm:gap-2 sm:px-5 sm:text-xs"
          >
            Read More
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 sm:h-3.5 sm:w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}
