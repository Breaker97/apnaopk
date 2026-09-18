import {
  SERVICE_BENEFIT_ICONS,
  ServiceBenefits,
  type ServiceBenefitItem,
} from "@/components/store/sections/service-benefits";
import { ElectronicsServiceBenefits } from "@/components/store/sections/themes/electronics-service-benefits";
import { lt } from "../localized";
import type {
  BlockInstance,
  LocalizedText,
  SectionDefinition,
  SectionRenderContext,
} from "../types";

/** The visible perks, resolved once for whichever design draws them. */
function benefitItems(
  blocks: BlockInstance[],
  ctx: SectionRenderContext,
): ServiceBenefitItem[] {
  return blocks
    .filter((block) => block.visible)
    .map((block) => ({
      id: block.id,
      icon: block.settings.icon as string,
      title: lt(block.settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage),
      text: lt(block.settings.text as LocalizedText, ctx.locale, ctx.defaultLanguage),
    }));
}

export const serviceBenefits: SectionDefinition = {
  type: "service-benefits",
  version: 1,
  category: "content",
  // Two drawings of the same perks; the active template picks one.
  designFollowsTheme: true,
  variants: [
    {
      key: "classic",
      name: "Classic",
      Render: ({ blocks, ctx }) => <ServiceBenefits items={benefitItems(blocks, ctx)} />,
    },
    {
      key: "electronics",
      name: "Spec bar",
      Render: ({ blocks, ctx }) => (
        <ElectronicsServiceBenefits items={benefitItems(blocks, ctx)} />
      ),
    },
  ],
  fields: [],
  blocks: [
    {
      type: "benefit",
      max: 8,
      fields: [
        {
          key: "icon",
          type: "select",
          options: SERVICE_BENEFIT_ICONS,
          default: "truck",
        },
        { key: "title", type: "text", translatable: true, default: "" },
        { key: "text", type: "text", translatable: true, default: "" },
      ],
    },
  ],
  starter: {
    blocks: [
      {
        type: "benefit",
        settings: {
          icon: "truck",
          title: "Free Shipping",
          text: "On orders over $50",
        },
      },
      {
        type: "benefit",
        settings: {
          icon: "shield",
          title: "Secure Payment",
          text: "100% protected checkout",
        },
      },
      {
        type: "benefit",
        settings: {
          icon: "returns",
          title: "Easy Returns",
          text: "30-day return policy",
        },
      },
      {
        type: "benefit",
        settings: {
          icon: "support",
          title: "24/7 Support",
          text: "We're here to help",
        },
      },
    ],
  },
  Render({ blocks, ctx }) {
    return <ServiceBenefits items={benefitItems(blocks, ctx)} />;
  },
};
