import { FaqSection } from "@/components/store/sections/faq-section";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const faq: SectionDefinition = {
  type: "faq",
  version: 1,
  category: "more",
  fields: [
    { key: "title", type: "text", translatable: true, default: "Frequently Asked Questions" },
  ],
  blocks: [
    {
      type: "item",
      max: 20,
      fields: [
        { key: "question", type: "text", translatable: true, default: "" },
        { key: "answer", type: "textarea", translatable: true, default: "" },
      ],
    },
  ],
  starter: {
    blocks: [{ type: "item" }],
  },
  Render({ settings, blocks, ctx }) {
    return (
      <FaqSection
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        items={blocks
          .filter((block) => block.visible)
          .map((block) => ({
            id: block.id,
            question: lt(block.settings.question as LocalizedText, ctx.locale, ctx.defaultLanguage),
            answer: lt(block.settings.answer as LocalizedText, ctx.locale, ctx.defaultLanguage),
          }))}
      />
    );
  },
};
