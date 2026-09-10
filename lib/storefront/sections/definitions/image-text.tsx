import { ImageText } from "@/components/store/sections/image-text";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const imageText: SectionDefinition = {
  type: "image-text",
  version: 1,
  category: "content",
  suggested: true,
  fields: [
    { key: "image", type: "image" },
    {
      key: "imagePosition",
      type: "select",
      options: ["left", "right"],
      default: "left",
    },
    { key: "heading", type: "text", translatable: true, default: "" },
    { key: "body", type: "richtext", translatable: true, default: "" },
    { key: "ctaLabel", type: "text", translatable: true, default: "" },
    { key: "link", type: "url", default: "" },
  ],
  Render({ settings, ctx }) {
    return (
      <ImageText
        locale={ctx.locale}
        imageSrc={settings.image as string}
        imagePosition={settings.imagePosition as "left" | "right"}
        heading={lt(settings.heading as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        body={lt(settings.body as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        ctaLabel={lt(settings.ctaLabel as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        href={settings.link as string}
      />
    );
  },
};
