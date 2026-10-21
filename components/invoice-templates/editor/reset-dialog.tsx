"use client";

/**
 * Reset (§5.2): always asks first, and offers Discard unsaved changes ·
 * Restore preset layout (only for a template made from a preset) · Reset
 * styles only · Cancel. Each choice is one undo step; nothing is saved until
 * Save. The choices that would change nothing are greyed out.
 */
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { presetName } from "@/lib/invoice-templates/presets";
import { designEquals } from "@/lib/invoice-templates/editor/operations";
import { resetDesign, resetPresetKey, type ResetKind } from "@/lib/invoice-templates/editor/reset";
import { selectIsDirty, useEditor, useEditorApi } from "./editor-store";

function Choice({ title, hint, onClick, disabled, kind }: { title: string; hint: string; onClick: () => void; disabled?: boolean; kind: ResetKind }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-reset={kind}
      className="w-full rounded-md border px-3 py-2.5 text-start transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

export function ResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("admin.invoiceTemplates.editor.reset");
  const api = useEditorApi();
  const dirty = useEditor(selectIsDirty);
  const isDraft = useEditor((state) => state.isDraft);
  const preset = resetPresetKey(useEditor((state) => state.presetKey));
  const design = useEditor((state) => state.design);
  const baseline = useEditor((state) => state.baseline.design);
  const changes = (kind: ResetKind) =>
    open && !designEquals(resetDesign(kind, { design, baseline, presetKey: preset }), design);

  const choose = (kind: ResetKind) => {
    api.getState().reset(kind);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-reset-dialog="">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Choice
            kind="discard"
            title={t("discard")}
            hint={isDraft ? t("discardDraftHint") : t("discardHint")}
            disabled={!dirty}
            onClick={() => choose("discard")}
          />
          {preset && (
            <Choice
              kind="preset"
              title={t("preset")}
              hint={t("presetHint", { preset: presetName(preset, design.locale) })}
              disabled={!changes("preset")}
              onClick={() => choose("preset")}
            />
          )}
          <Choice kind="styles" title={t("styles")} hint={t("stylesHint")} disabled={!changes("styles")} onClick={() => choose("styles")} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
