"use client";

/**
 * The right panel (§5.5): three tabs.
 *
 * - **Design**: with nothing selected, the page and the template's formats
 *   (canvas-settings.tsx). With one element, its property sections
 *   (element-property-sections.tsx, the Phase 5 mount point: Header, Content,
 *   Position & size, Typography, …). With several, how many — Arrange above
 *   the canvas acts on them all.
 * - **Layers**: layers-panel.tsx.
 * - **Review**: review-panel.tsx — the warnings by element name and a live
 *   preview (sample data, or a real order loaded read-only).
 *
 * The open tab lives in the store (`panelTab`) so the warnings chip can switch to it.
 */
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import { ClipboardCheck, Layers, Paintbrush } from "lucide-react";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/admin/underline-tabs";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CanvasSettings } from "./canvas-settings";
import { selectedElements, useEditor, useEditorApi, type PanelTab } from "./editor-store";
import { EDITOR_CARD_CLASS, EDITOR_HINT_CLASS } from "./editor-styles";
import { ElementPropertySections } from "./element-property-sections";
import { ReviewPanel, useReviewWarnings } from "./review-panel";
import { LayersPanel } from "./layers-panel";

/** Three tabs share the panel's width: each takes a third, its icon beside its label. */
const TAB_CLASS = "flex-1 justify-center gap-1.5 px-2 py-2.5";

function DesignTab() {
  const t = useTranslations("admin.invoiceTemplates.editor.panel");
  const selected = useEditor(useShallow((state) => selectedElements(state)));

  if (selected.length === 0) return <CanvasSettings />;
  if (selected.length > 1) {
    return (
      <div className={cn(EDITOR_CARD_CLASS, "space-y-1 p-3")}>
        <p className="text-xs font-semibold">{t("many", { count: selected.length })}</p>
        <p className={EDITOR_HINT_CLASS}>{t("manyHint")}</p>
      </div>
    );
  }
  const element = selected[0]!;
  return (
    <div data-element-design={element.id}>
      <ElementPropertySections element={element} />
    </div>
  );
}

export function EditorPanel() {
  const t = useTranslations("admin.invoiceTemplates.editor.panel");
  const api = useEditorApi();
  const tab = useEditor((state) => state.panelTab);
  const warningCount = useReviewWarnings().length;

  return (
    <div data-editor-panel="">
      <h2 className="sr-only">{t("title")}</h2>
      <Tabs value={tab} onValueChange={(value) => api.getState().setPanelTab(value as PanelTab)} className="gap-0">
        {/* The admin's underline tabs, as on Invoice Settings and Online Store → Themes, kept in view while the panel scrolls. */}
        <div className="sticky top-0 z-10 bg-card px-2 pt-1">
          <UnderlineTabsList aria-label={t("tabs")} className="gap-0">
            <UnderlineTabsTrigger value="design" data-panel-tab="design" icon={Paintbrush} className={TAB_CLASS}>
              {t("design")}
            </UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="layers" data-panel-tab="layers" icon={Layers} className={TAB_CLASS}>
              {t("layers")}
            </UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="review" data-panel-tab="review" icon={ClipboardCheck} className={TAB_CLASS}>
              {t("review")}
              {warningCount > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold tabular-nums text-amber-800 dark:text-amber-300" data-review-badge="">
                  {warningCount}
                </span>
              )}
            </UnderlineTabsTrigger>
          </UnderlineTabsList>
        </div>
        <TabsContent value="design" className="mt-0 p-3">
          <DesignTab />
        </TabsContent>
        <TabsContent value="layers" className="mt-0">
          <LayersPanel />
        </TabsContent>
        <TabsContent value="review" className="mt-0">
          <ReviewPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
