/**
 * The store's own pages and its blog, for the app to draw as screens of its
 * own rather than as the website in a web view.
 *
 * GET /pages/{handle} (static, 60 s): a page the merchant writes in Online
 * Store → Pages, which the website shows at its own address: `privacy`
 * (/privacy), `terms` (/terms), `cookies` (/cookies), `accessibility`
 * (/accessibility), and a page of their own at /pages/{handle}. A page the
 * merchant hides, or that does not exist, is 404 NOT_FOUND. A page the
 * website builds from its theme's sections (a landing page) cannot be drawn
 * from `html`: it is 404 NOT_FOUND with reason WEB_ONLY, and the app opens
 * the website's page instead.
 *
 * GET /faq (static, 60 s): the questions and answers of /faq. 404 NOT_FOUND
 * while the merchant hides the page.
 *
 * GET /blog (public, `ETag`): the published articles, newest first, a page at
 * a time; `?category=` (a category's `slug`) and `?tag=` narrow it as the
 * website's links do (/blog?category=…, /blog?tag=…).
 * GET /blog/{slug} (static, 60 s): one published article. One that is a draft,
 * scheduled for later, private or gone is 404 NOT_FOUND.
 *
 * Every `html` is the merchant's rich text, sanitized by the store (the
 * website's own allow-list: no script, no style, no event handler) and with
 * its pictures at absolute addresses. Its links are as the merchant wrote
 * them: a path of the store's website (`/products/red-shoe`), or another
 * site's address. The app draws only what it knows of it and follows a link
 * the way it follows any other link to the store.
 *
 * GET /about, GET /contact and GET /return-policy (static, 60 s): the
 * website's /about, /contact and /returns, which are built from fields
 * rather than written as one page: each answer is those fields, with every
 * part the website leaves out (switched off, or empty) left out, and the
 * placeholders the merchant may write (`{storeName}`, `{windowDays}`)
 * filled. 404 NOT_FOUND while the merchant hides the page. A `path` is a
 * page of the store's website, which the app follows by its link table.
 *
 * POST /contact/messages: the contact form, as the website's sends it: the
 * same checks, the same limit (5 in 15 minutes), the message landing in the
 * store's inbox and its email. Needs an `Idempotency-Key`.
 *
 * None of this is translated: the merchant writes these pages and articles
 * once, and every language reads the same words, as on the website. Only the
 * About page's live figures are written in the shopper's language.
 */
import * as z from "zod";

import { ImageSet, ListQuery, listOf } from "./common";
import { BENEFIT_ICONS } from "./home";

/**
 * The `reason` of a 404 from GET /pages/{handle}. `WEB_ONLY`: the page
 * exists, but only the website can show it; open the website's address.
 */
export const CONTENT_PAGE_REASONS = ["WEB_ONLY"] as const;

/** GET /pages/{handle} */
export const ContentPage = z.object({
  /** As asked: `privacy`, `terms`, `cookies`, `accessibility`, or the page's own handle. */
  handle: z.string(),
  title: z.string(),
  /** The page's body. */
  html: z.string(),
  /** ISO time it was last changed, when the store keeps it (a page of the merchant's own). */
  updatedAt: z.string().optional(),
});
export type ContentPage = z.infer<typeof ContentPage>;

/** One question of the FAQ. The answer is plain text, its line breaks kept. */
export const FaqItem = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
});
export type FaqItem = z.infer<typeof FaqItem>;

/** GET /faq */
export const FaqPage = z.object({
  title: z.string(),
  /** The line under the title, when the merchant wrote one. */
  subtitle: z.string().optional(),
  items: z.array(FaqItem),
});
export type FaqPage = z.infer<typeof FaqPage>;

/** A category of the blog. `slug` is what `?category=` takes. */
export const BlogArticleCategory = z.object({
  slug: z.string(),
  name: z.string(),
});
export type BlogArticleCategory = z.infer<typeof BlogArticleCategory>;

/** An article as a list shows it. The app opens `/blog/{slug}`. */
export const BlogArticleSummary = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
  /** The cover picture. */
  image: ImageSet.optional(),
  authorName: z.string().optional(),
  /** ISO time it was published. */
  publishedAt: z.string().optional(),
});
export type BlogArticleSummary = z.infer<typeof BlogArticleSummary>;

/** Query of GET /blog. */
export const BlogArticleListQuery = ListQuery.extend({
  /** A category's `slug`. One the store does not have narrows nothing, as on the website. */
  category: z.string().optional(),
  /** One of the articles' tags. */
  tag: z.string().optional(),
});
export type BlogArticleListQuery = z.infer<typeof BlogArticleListQuery>;

/** GET /blog */
export const BlogArticleList = listOf(BlogArticleSummary).extend({
  /** The blog's categories, in the store's order: the chips above the list. */
  categories: z.array(BlogArticleCategory),
});
export type BlogArticleList = z.infer<typeof BlogArticleList>;

/** GET /blog/{slug} */
export const BlogArticle = BlogArticleSummary.extend({
  /** The article's body. */
  html: z.string(),
  /** The author's picture. */
  authorImage: ImageSet.optional(),
  /** ISO time it was last changed. */
  updatedAt: z.string().optional(),
  /** The store's estimate of the minutes it takes to read, when it has one. */
  readingMinutes: z.number().int().positive().optional(),
  categories: z.array(BlogArticleCategory),
  /** Each opens `/blog?tag={tag}`. */
  tags: z.array(z.string()),
  /** Up to three articles that share a category or a tag with it. */
  related: z.array(BlogArticleSummary),
});
export type BlogArticle = z.infer<typeof BlogArticle>;

/** A button of a page: its words, and the website's page it opens (`/products`, `/contact`). */
export const PageAction = z.object({
  label: z.string(),
  path: z.string(),
});
export type PageAction = z.infer<typeof PageAction>;

/** One entry of a list on a page: a step, a rule, a milestone (its year the `title`). */
export const PageItem = z.object({
  id: z.string(),
  title: z.string().optional(),
  text: z.string().optional(),
});
export type PageItem = z.infer<typeof PageItem>;

/** A part of a page: its heading, the line under it, and its entries. */
export const PageSection = z.object({
  title: z.string(),
  text: z.string().optional(),
  items: z.array(PageItem),
});
export type PageSection = z.infer<typeof PageSection>;

/** One way to reach the store: the merchant's heading for it, what it is, and what opens it. */
export const ContactLine = z.object({
  label: z.string(),
  value: z.string(),
  /** `mailto:…`, `tel:…`, or the address on a map; none for the opening hours. */
  href: z.string().optional(),
});
export type ContactLine = z.infer<typeof ContactLine>;

export const SOCIAL_NETWORKS = ["FACEBOOK", "TWITTER", "INSTAGRAM", "YOUTUBE", "LINKEDIN"] as const;

/** One of the store's profiles. A network the app does not know draws a plain link. */
export const SocialLink = z.object({
  network: z.enum(SOCIAL_NETWORKS),
  url: z.string(),
});
export type SocialLink = z.infer<typeof SocialLink>;

/** The store's address, email, phone and hours, each only when the store has one. */
export const StoreContact = z.object({
  address: ContactLine.optional(),
  email: ContactLine.optional(),
  phone: ContactLine.optional(),
  hours: ContactLine.optional(),
  /** In the website's order; empty when the merchant hides them. */
  social: z.array(SocialLink),
});
export type StoreContact = z.infer<typeof StoreContact>;

/** A figure of the About page: the merchant's own, or a live count written in the shopper's language. */
export const AboutStat = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
});
export type AboutStat = z.infer<typeof AboutStat>;

/** One of the store's values. An icon the app does not know draws a plain one. */
export const AboutValue = z.object({
  id: z.string(),
  icon: z.enum(BENEFIT_ICONS),
  title: z.string(),
  text: z.string().optional(),
});
export type AboutValue = z.infer<typeof AboutValue>;

export const AboutTeamMember = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  bio: z.string().optional(),
  image: ImageSet.optional(),
  /** Their profile on another site. */
  url: z.string().optional(),
});
export type AboutTeamMember = z.infer<typeof AboutTeamMember>;

/** A review of the store's, as the About page quotes it. */
export const AboutTestimonial = z.object({
  id: z.string(),
  rating: z.number(),
  title: z.string().optional(),
  comment: z.string(),
  reviewerName: z.string().optional(),
});
export type AboutTestimonial = z.infer<typeof AboutTestimonial>;

/** The closing call of a page, with up to two buttons. */
export const PageClosing = z.object({
  title: z.string(),
  text: z.string().optional(),
  primaryAction: PageAction.optional(),
  secondaryAction: PageAction.optional(),
});
export type PageClosing = z.infer<typeof PageClosing>;

/** GET /about. Each part is there only when the website shows it. */
export const AboutPage = z.object({
  title: z.string(),
  eyebrow: z.string().optional(),
  headline: z.string(),
  description: z.string().optional(),
  image: ImageSet.optional(),
  primaryAction: PageAction.optional(),
  secondaryAction: PageAction.optional(),
  /** Two or more, or none. */
  stats: z.array(AboutStat),
  statsFootnote: z.string().optional(),
  howItWorks: z
    .object({
      title: z.string(),
      text: z.string().optional(),
      /** How buying works. */
      shoppers: PageSection.optional(),
      /** How selling works, on a store with sellers of its own. */
      sellers: PageSection.extend({ action: PageAction.optional() }).optional(),
      /** The promises beside the steps. */
      protections: z.array(PageItem),
    })
    .optional(),
  values: z
    .object({
      title: z.string(),
      mission: z.string().optional(),
      items: z.array(AboutValue),
    })
    .optional(),
  /** The store's story; `html` as on GET /pages/{handle}. */
  story: z.object({ title: z.string(), html: z.string() }).optional(),
  milestones: PageSection.optional(),
  team: z
    .object({
      title: z.string(),
      text: z.string().optional(),
      members: z.array(AboutTeamMember),
    })
    .optional(),
  testimonials: z
    .object({
      title: z.string(),
      text: z.string().optional(),
      items: z.array(AboutTestimonial),
    })
    .optional(),
  contact: z
    .object({
      title: z.string(),
      text: z.string().optional(),
      details: StoreContact,
      /** To the Contact page, while the store shows it. */
      action: PageAction.optional(),
    })
    .optional(),
  closing: PageClosing.optional(),
});
export type AboutPage = z.infer<typeof AboutPage>;

/** GET /contact */
export const ContactPage = z.object({
  title: z.string(),
  description: z.string().optional(),
  image: ImageSet.optional(),
  /** The heading over the ways to reach the store, and its line. */
  intro: z.object({ title: z.string(), text: z.string().optional() }),
  details: StoreContact,
  /** The heading over the form (POST /contact/messages), and its line. */
  form: z.object({ title: z.string(), text: z.string().optional() }),
  /** Where the store is, when the merchant shows the map: `url` opens it. */
  map: z
    .object({
      title: z.string(),
      text: z.string().optional(),
      label: z.string().optional(),
      url: z.string(),
    })
    .optional(),
});
export type ContactPage = z.infer<typeof ContactPage>;

/** GET /return-policy: the website's /returns. */
export const ReturnPolicyPage = z.object({
  title: z.string(),
  eyebrow: z.string().optional(),
  description: z.string().optional(),
  /** On the website, the shopper's orders (`/account/orders`) and order tracking (`/track-order`). */
  primaryAction: PageAction.optional(),
  secondaryAction: PageAction.optional(),
  /** "Return window: 30 days", in the merchant's words. */
  window: z.object({ label: z.string(), value: z.string() }),
  /** The short points under the window. */
  summary: z.array(z.string()),
  howItWorks: PageSection.optional(),
  eligible: PageSection.optional(),
  excluded: PageSection.optional(),
  refundRules: PageSection.optional(),
  statuses: PageSection.optional(),
  beforeReturn: z.object({ title: z.string(), text: z.string().optional() }).optional(),
  /** Who to ask: the store's email and phone, when it has them. */
  help: z.object({
    title: z.string(),
    email: ContactLine.optional(),
    phone: ContactLine.optional(),
  }),
  closing: PageClosing.optional(),
});
export type ReturnPolicyPage = z.infer<typeof ReturnPolicyPage>;

/**
 * POST /contact/messages, the website's contact form. Signed in, the message
 * comes from the shopper's account and the store answers in their inbox; the
 * name and email are still where the store's email replies.
 */
export const ContactMessageRequest = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(100).optional(),
  subject: z.string().trim().min(3).max(140),
  message: z.string().trim().min(10).max(2000),
});
export type ContactMessageRequest = z.infer<typeof ContactMessageRequest>;

export const ContactMessageResult = z.object({
  /** For a signed-in shopper: the conversation it started or joined, `/account/inbox?conversation={id}`. */
  conversationId: z.string().optional(),
});
export type ContactMessageResult = z.infer<typeof ContactMessageResult>;
