import Link from "next/link";
import { type Locale } from "@/config/i18n.config";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { MoveRight } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  getStorefrontBlogIndex,
  type BlogListItem,
} from "@/lib/blog/storefront-blog-posts";
import {
  BlogArticleCard,
  type BlogArticleCardData,
} from "@/components/store/blog/blog-article-card";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function chipClass(isActive: boolean) {
  return isActive
    ? "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-foreground bg-foreground px-4 text-xs font-medium text-background md:h-7 md:min-w-20 md:px-5"
    : "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground md:h-7 md:min-w-20 md:px-5";
}

function toBlogArticleCard(post: BlogListItem): BlogArticleCardData {
  return {
    _id: post._id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    image: post.featuredImage?.url || "",
    imageAlt: post.featuredImage?.alt || post.title,
    authorName: post.authorName,
    authorImage: post.authorImage,
    publishedAt: post.publishedAt,
  };
}

export default async function BlogIndexPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const page = typeof sp.page === "string" ? parseInt(sp.page, 10) || 1 : 1;
  const search = typeof sp.search === "string" ? sp.search : "";
  const categorySlug = typeof sp.category === "string" ? sp.category : "";
  const tag = typeof sp.tag === "string" ? sp.tag : "";

  const [t, { categories, items, pagination }] = await Promise.all([
    getTranslations({ locale }),
    getStorefrontBlogIndex({
      page,
      search,
      categorySlug,
      tag,
    }),
  ]);

  const featuredPost = page === 1 ? items[0] : undefined;
  const gridPosts = featuredPost ? items.slice(1) : items;
  const totalPages = pagination.totalPages;

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (categorySlug) next.set("category", categorySlug);
    if (tag) next.set("tag", tag);
    if (nextPage > 1) next.set("page", String(nextPage));
    const queryString = next.toString();
    return `/${locale}/blog${queryString ? `?${queryString}` : ""}`;
  };

  return (
    <main className="bg-background">
      <div className="container mx-auto max-w-[1310px] px-4 pb-8 pt-6 md:pb-16 md:pt-14">
        <StoreBreadcrumb
          className="mb-6 md:mb-8"
          locale={locale}
          items={[{ label: t("nav.blog") }]}
        />

        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-foreground md:text-[40px]">
            Latest Guides and News
          </h1>
          <p className="mt-2 text-sm text-foreground/80 md:mt-4 md:text-base">
            Stories from Overflow on design, user flows, UI, UX and more from
            the experts.
          </p>
        </div>

        {categories.length > 0 ? (
          <nav
            aria-label="Blog categories"
            className="scrollbar-hide -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 [mask-image:linear-gradient(90deg,#000_92%,transparent)] md:mx-0 md:mt-7 md:flex-wrap md:justify-center md:gap-3 md:overflow-visible md:px-0 md:[mask-image:none]"
          >
            <Link href={`/${locale}/blog`} className={chipClass(!categorySlug)}>
              All
            </Link>
            {categories.slice(0, 7).map((category) => {
              const isActive = category.slug === categorySlug;
              return (
                <Link
                  key={category._id}
                  href={`/${locale}/blog?category=${category.slug}`}
                  className={chipClass(isActive)}
                >
                  {category.name}
                </Link>
              );
            })}
          </nav>
        ) : null}

        {items.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed p-10 text-center text-muted-foreground md:mt-20 md:p-16">
            No articles published yet.
          </div>
        ) : (
          <>
            {featuredPost ? (
              <FeaturedPost post={featuredPost} locale={locale as Locale} />
            ) : null}

            {gridPosts.length > 0 ? (
              <section className="mt-8 md:mt-20">
                <div className="flex items-center gap-3">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground md:text-xs">
                    Latest Articles
                  </h2>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  <span className="inline-flex h-5 items-center justify-center rounded-full border border-border px-2 text-[10px] font-semibold text-muted-foreground">
                    {pagination.total}
                  </span>
                </div>
                <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-2 md:mt-5 lg:grid-cols-3 lg:gap-5">
                  {gridPosts.map((post) => (
                    <BlogArticleCard
                      key={post._id}
                      article={toBlogArticleCard(post)}
                      locale={locale as Locale}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        {totalPages > 1 ? (
          <Pagination className="mt-8 md:mt-12">
            <PaginationContent>
              {page > 1 ? (
                <PaginationItem>
                  <PaginationPrevious href={buildHref(page - 1)} />
                </PaginationItem>
              ) : null}
              {Array.from({ length: totalPages })
                .slice(0, 7)
                .map((_, index) => {
                  const pageNumber = index + 1;
                  return (
                    <PaginationItem key={pageNumber}>
                      <PaginationLink
                        href={buildHref(pageNumber)}
                        isActive={page === pageNumber}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
              {page < totalPages ? (
                <PaginationItem>
                  <PaginationNext href={buildHref(page + 1)} />
                </PaginationItem>
              ) : null}
            </PaginationContent>
          </Pagination>
        ) : null}
      </div>
    </main>
  );
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

function AuthorMeta({ post }: { post: BlogListItem }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted md:h-10 md:w-10">
        {post.authorImage ? (
          <AppImage
            src={post.authorImage}
            alt={post.authorName}
            width={40}
            height={40}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs font-semibold text-muted-foreground">
            {post.authorName.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {post.authorName}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatDate(post.publishedAt)}
        </p>
      </div>
    </div>
  );
}

function ReadMoreLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-foreground/80 bg-background px-4 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:text-primary md:h-10 md:px-6 md:text-sm"
    >
      Read More
      <MoveRight
        strokeWidth={1.5}
        className="h-4 w-4 transition-transform group-hover:translate-x-0.5 md:h-5 md:w-5"
      />
    </Link>
  );
}

function FeaturedPost({
  post,
  locale,
}: {
  post: BlogListItem;
  locale: Locale;
}) {
  const href = `/${locale}/blog/${post.slug}`;

  return (
    <article className="mt-8 grid items-center gap-3.5 md:mt-20 md:grid-cols-[1.3fr_1fr] md:gap-10 lg:gap-[60px]">
      <Link
        href={href}
        className="relative block aspect-[16/10] overflow-hidden rounded-xl bg-muted md:aspect-[1.8/1]"
      >
        {post.featuredImage?.url ? (
          <AppImage
            src={post.featuredImage.url}
            alt={post.featuredImage.alt || post.title}
            width={760}
            height={442}
            className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-muted text-sm text-muted-foreground">
            No image
          </div>
        )}
        <span className="absolute left-2.5 top-2.5 inline-flex h-6 items-center rounded-full bg-primary px-2.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground md:hidden">
          Featured
        </span>
      </Link>

      <div className="flex min-h-full flex-col justify-center">
        <Link href={href}>
          <h2 className="max-w-md text-xl font-bold leading-snug text-foreground transition-colors hover:text-primary md:text-[32px] md:leading-tight">
            {post.title}
          </h2>
        </Link>
        {post.excerpt ? (
          <p className="mt-3 line-clamp-3 max-w-md text-sm leading-relaxed text-muted-foreground md:mt-8 md:line-clamp-none md:text-base">
            {post.excerpt}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-3 md:mt-9">
          <AuthorMeta post={post} />
          <ReadMoreLink href={href} />
        </div>
      </div>
    </article>
  );
}
