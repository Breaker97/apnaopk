import { HomeTopArticles } from "@/components/store/blog/home-top-articles";
import { TopArticlesSkeleton } from "@/components/store/home-section-skeletons";
import {
  TOP_ARTICLES_COLUMNS_MAX,
  TOP_ARTICLES_COLUMNS_MIN,
} from "@/lib/site-config/home-page-config";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";
import { themeUsesTwoToneHeadings } from "@/lib/storefront/themes/registry";

export const blogPosts: SectionDefinition = {
  type: "blog-posts",
  version: 1,
  category: "content",
  fields: [
    { key: "title", type: "text", translatable: true, default: "Top Articles" },
    { key: "limit", type: "number", default: 9, min: 1, max: 12 },
    {
      key: "desktopColumns",
      type: "number",
      default: 4,
      min: TOP_ARTICLES_COLUMNS_MIN,
      max: TOP_ARTICLES_COLUMNS_MAX,
    },
  ],
  Render({ settings, ctx }) {
    return (
      <HomeTopArticles
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        limit={settings.limit as number}
        desktopColumns={settings.desktopColumns as number}
        // The template's data decides the heading treatment (`headingStyle`),
        // the same one the compare and all-categories pages wear.
        themedHeading={themeUsesTwoToneHeadings(ctx.themeId)}
      />
    );
  },
  Skeleton: ({ settings }) => (
    <TopArticlesSkeleton desktopColumns={settings.desktopColumns as number} />
  ),
};
