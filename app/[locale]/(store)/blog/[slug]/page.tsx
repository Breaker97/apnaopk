import Link from "next/link";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { AppImage } from "@/components/ui/app-image";
import { sanitizeHtml } from "@/lib/sanitize";
import { Badge } from "@/components/ui/badge";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { CommentsSection } from "@/components/store/blog/comments-section";
import { BlogPostViewTracker } from "@/components/store/blog/blog-post-view-tracker";
import { getPublishedBlogPostDetail } from "@/lib/blog/storefront-blog-posts";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/* One fixed reading column for the whole article — the storefront `.container`
   is theme-owned (globals.css sizes it from --store-page-width and outranks any
   max-w-* set on the same element), so the article opts out of `.container` and
   pins its own width instead. */
const COLUMN = "mx-auto w-full max-w-4xl px-4";

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublishedBlogPostDetail(slug);
  if (!data) return {};
  const { post } = data;
  return {
    title: post.seo?.pageTitle || post.title,
    description: post.seo?.metaDescription || post.excerpt || undefined,
    openGraph: {
      title: post.seo?.pageTitle || post.title,
      description: post.seo?.metaDescription || post.excerpt || undefined,
      images: post.featuredImage?.url ? [post.featuredImage.url] : undefined,
      type: "article",
    },
  };
}

export default async function BlogDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const [t, data] = await Promise.all([
    getTranslations({ locale }),
    getPublishedBlogPostDetail(slug),
  ]);
  if (!data) notFound();
  const { post, related } = data;
  const author = post.author?.name || post.authorName || "Author";

  /* Byline facts read as one sentence, so they are joined rather than laid out
     as separate icon chips — the chips wrapped into a second ragged row on the
     narrow column and competed with the title for attention. */
  const meta = [
    post.publishedAt
      ? new Date(post.publishedAt).toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null,
    post.readingTime ? `${post.readingTime} min read` : null,
    post.allowComments ? `${post.commentCount ?? 0} comments` : null,
  ].filter(Boolean) as string[];

  return (
    <article className="bg-background">
      <BlogPostViewTracker slug={slug} />

      {/* Left-aligned masthead: the breadcrumb is a left-edge element by
          nature, and a centred title beside it read as two different pages.
          Everything above the article now hangs off the same edge. */}
      <header className={`${COLUMN} pt-6 pb-8 sm:pt-8`}>
        <StoreBreadcrumb
          className="mb-6"
          locale={locale}
          items={[
            { label: t("nav.blog"), href: "/blog" },
            { label: post.title },
          ]}
        />

        {post.categories && post.categories.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {post.categories.map((c) => (
              <Link key={c._id} href={`/${locale}/blog?category=${c.slug}`}>
                <Badge variant="secondary" className="hover:bg-secondary/70">
                  {c.name}
                </Badge>
              </Link>
            ))}
          </div>
        ) : null}

        <h1 className="text-3xl font-bold leading-[1.15] tracking-tight text-balance sm:text-4xl lg:text-[2.5rem]">
          {post.title}
        </h1>

        {post.excerpt ? (
          <p className="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
            {post.excerpt}
          </p>
        ) : null}

        <div className="mt-8 flex items-center gap-3 border-t pt-6">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
            {post.author?.image ? (
              <AppImage
                src={post.author.image}
                alt={author}
                width={40}
                height={40}
                className="h-10 w-10 object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-sm font-semibold">
                {author.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{author}</p>
            {meta.length > 0 ? (
              <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>
            ) : null}
          </div>
        </div>
      </header>

      {post.featuredImage?.url ? (
        <div className={COLUMN}>
          <div className="aspect-[16/9] overflow-hidden rounded-2xl border bg-muted">
            <AppImage
              src={post.featuredImage.url}
              alt={post.featuredImage.alt || post.title}
              width={1200}
              height={675}
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      ) : null}

      <div className={`${COLUMN} py-10 sm:py-12`}>
        <div
          className="rich-text-content article-body max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content) }}
        />

        {post.tags && post.tags.length > 0 ? (
          <div className="mt-12 flex flex-wrap gap-2 border-t pt-6">
            {post.tags.map((tag) => (
              <Link key={tag} href={`/${locale}/blog?tag=${tag}`}>
                <Badge
                  variant="outline"
                  className="rounded-full capitalize hover:bg-muted"
                >
                  #{tag}
                </Badge>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {related && related.length > 0 ? (
        <section className="border-t bg-muted/20 py-12">
          <div className={COLUMN}>
            <h2 className="mb-6 text-xl font-semibold tracking-tight">
              Related articles
            </h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {related.map((p) => (
                <Link
                  key={p._id}
                  href={`/${locale}/blog/${p.slug}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-md"
                >
                  <div className="aspect-[16/10] overflow-hidden bg-muted">
                    {p.featuredImage?.url ? (
                      <AppImage
                        src={p.featuredImage.url}
                        alt={p.title}
                        width={640}
                        height={400}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">
                      {p.title}
                    </h3>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {p.excerpt || ""}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {post.allowComments ? (
        <section className={`${COLUMN} py-12`}>
          <CommentsSection postId={post._id} />
        </section>
      ) : null}
    </article>
  );
}
