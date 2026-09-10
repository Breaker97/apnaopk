import { sanitizeHtml } from "@/lib/sanitize";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";

interface ContentPageViewProps {
  locale: string;
  title: string;
  content: string;
}

/**
 * Shared shell for every admin-authored content page (privacy, terms, cookies,
 * accessibility, custom pages). The breadcrumb lives here rather than in the
 * five routes so those pages stay one call each and cannot drift apart.
 */
export function ContentPageView({
  locale,
  title,
  content,
}: ContentPageViewProps) {
  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto max-w-4xl px-4">
        {/* The title is the crumb: these pages are named by the merchant, so
            there is no fixed label to translate. */}
        <StoreBreadcrumb locale={locale} items={[{ label: title }]} />

        <article className="rounded-2xl border border-border/70 bg-card/95 p-6 md:p-8">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          <div
            className="rich-text-content mt-6 max-w-none text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
          />
        </article>
      </div>
    </section>
  );
}
