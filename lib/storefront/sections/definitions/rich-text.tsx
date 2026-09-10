import { RichText } from "@/components/store/sections/rich-text";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const richText: SectionDefinition = {
  type: "rich-text",
  version: 1,
  category: "content",
  fields: [
    { key: "heading", type: "text", translatable: true, default: "" },
    { key: "body", type: "richtext", translatable: true, default: "" },
    {
      key: "width",
      type: "select",
      options: ["narrow", "full"],
      default: "narrow",
    },
  ],
  Render({ settings, ctx }) {
    return (
      <RichText
        heading={lt(settings.heading as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        body={lt(settings.body as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        width={settings.width as "narrow" | "full"}
      />
    );
  },
};
