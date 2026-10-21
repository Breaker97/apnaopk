"use client";

/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PHASE 5 MOUNT POINT — the selected element's property sections.       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * The Design tab renders this for exactly one selected element. It shows the
 * sections the capability map allows for the element's type, in the order of
 * §5.6: Header, Content, Position & size, Typography, Colours, Border &
 * spacing, Format, Style preset (`lib/invoice-templates/editor/
 * capabilities.ts` decides which; nothing here does).
 *
 * A block's own settings (§5.7) are the `config` section (blocks/), and a
 * repeating block's page flow is the `flow` section.
 *
 * How a section writes (notes/P4.md "The store", `properties/use-element-
 * edit.ts`): a function of the element's latest copy through `editElement`,
 * in a group per field so typing is one undo step (600 ms) and a pick, a
 * switch or a colour is a step of its own.
 *
 * Keep the `data-editor-panel-sections` wrapper: tests, the browser checks
 * and Enter-on-canvas focus ("the first property") find the sections by it.
 */
import type { ComponentType } from "react";
import { sectionsFor, type PropertySection } from "@/lib/invoice-templates/editor/capabilities";
import type { TemplateElement } from "@/lib/invoice-templates/types";
import { BlockConfigSection } from "./blocks/block-config-section";
import { FlowSection } from "./blocks/flow-section";
import { PositionSize } from "./position-size";
import { BorderSection } from "./properties/border-section";
import { ColoursSection } from "./properties/colours-section";
import { ContentSection } from "./properties/content-section";
import { FormatSection } from "./properties/format-section";
import { HeaderSection } from "./properties/header-section";
import { StylePresetSection } from "./properties/style-preset-section";
import { TypographySection } from "./properties/typography-section";

type SectionView = ComponentType<{ element: TemplateElement }>;

const SECTION_VIEWS: Record<PropertySection, SectionView> = {
  header: HeaderSection,
  content: ContentSection,
  config: BlockConfigSection,
  position: PositionSize,
  flow: FlowSection,
  typography: TypographySection,
  colours: ColoursSection,
  border: BorderSection,
  format: FormatSection,
  stylePreset: StylePresetSection,
};

export function ElementPropertySections({ element }: { element: TemplateElement }) {
  return (
    <div className="space-y-2" data-editor-panel-sections="" data-element-id={element.id} data-element-type={element.type}>
      {sectionsFor(element.type).map((section) => {
        const View = SECTION_VIEWS[section];
        return <View key={section} element={element} />;
      })}
    </div>
  );
}
