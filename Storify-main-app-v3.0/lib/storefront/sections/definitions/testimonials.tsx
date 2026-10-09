import { Testimonials } from "@/components/store/sections/testimonials";
import { LuxeTestimonials } from "@/components/store/sections/themes/luxe-testimonials";
import { TileRowSkeleton } from "@/components/store/sections/section-skeletons";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition, SectionRenderProps } from "../types";

/** The quotes' settings, read once for whichever design draws them. */
function testimonialProps({ settings, ctx }: SectionRenderProps) {
  return {
    locale: ctx.locale,
    title: lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage),
    minRating: settings.minRating as number,
    limit: settings.limit as number,
  };
}

export const testimonials: SectionDefinition = {
  type: "testimonials",
  version: 1,
  category: "content",
  designFollowsTheme: true,
  variants: [
    {
      key: "classic",
      name: "Cards",
      Render: (props) => <Testimonials {...testimonialProps(props)} />,
    },
    {
      key: "luxe",
      name: "Editorial",
      Render: (props) => <LuxeTestimonials {...testimonialProps(props)} />,
    },
  ],
  fields: [
    { key: "title", type: "text", translatable: true, default: "What Our Customers Say" },
    { key: "minRating", type: "number", default: 4, min: 1, max: 5 },
    { key: "limit", type: "number", default: 6, min: 3, max: 12 },
  ],
  Render(props) {
    return <Testimonials {...testimonialProps(props)} />;
  },
  Skeleton: () => (
    <TileRowSkeleton
      tiles={3}
      aspectClassName="h-40"
      columnsClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    />
  ),
};
