import { HomeFromInstagram } from "@/components/store/home-from-instagram";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/** The Instagram-style image strip: titled row of linked square images. */
export const imageGallery: SectionDefinition = {
  type: "image-gallery",
  version: 1,
  category: "content",
  fields: [
    { key: "title", type: "text", translatable: true, default: "From Instagram" },
  ],
  blocks: [
    {
      type: "image",
      fields: [
        { key: "image", type: "image" },
        { key: "link", type: "url" },
      ],
    },
  ],
  starter: {
    blocks: Array.from({ length: 5 }, () => ({ type: "image" })),
  },
  // Synchronous, like become-vendor: the component pads to five placeholder
  // tiles itself when no images are configured.
  Render({ settings, blocks, ctx }) {
    const items = blocks
      .filter((block) => block.visible)
      .map((block) => ({
        imageSrc: block.settings.image as string,
        href: block.settings.link as string,
      }));
    return (
      <HomeFromInstagram
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        items={items}
      />
    );
  },
};
