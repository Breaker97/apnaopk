"use client";

/**
 * The editor's top toolbar (§5.2): Back · the name (renamed in place) with
 * its unsaved mark · Undo / Redo · Size ▾ · Page view ▾ · zoom (−, %, +, Fit)
 * · the warnings chip · Reset · Test print · Save ▾ (Save, Save & set as
 * default, Save as…).
 *
 * Back is a link: the leave guard (hooks/use-leave-guard.ts) asks before it
 * drops unsaved changes. The toolbar is one row at 1440 px; below that it
 * wraps, and the labels give way to icons with tooltips.
 */
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  File,
  Files,
  Loader2,
  Maximize,
  PanelLeft,
  PanelRight,
  Printer,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "@/components/language/link";
import { useTemplateScope } from "@/components/invoice-templates/template-scope";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { stepZoom, ZOOM_STEPS } from "@/lib/invoice-templates/editor/geometry";
import { cn } from "@/lib/utils";
import { selectCanRedo, selectCanUndo, selectIsDirty, useEditor, useEditorApi, type PageView } from "./editor-store";
import { TOOL_BUTTON_CLASS, TOOL_GROUP_CLASS, TOOL_ICON_CLASS, TOOL_OUTLINE_ICON_CLASS } from "./editor-styles";
import { SizeMenu } from "./size-menu";
import { TemplateNameField } from "./template-name-field";
import { WarningsChip } from "./warnings-chip";

export interface EditorToolbarProps {
  onTestPrint: () => void;
  onSave: () => void;
  /** False: the caller may not save (the editor is read-only); Save and Save as… are off. */
  canSave?: boolean;
  /** Save as… (a saved template only). */
  onSaveAs?: () => void;
  /** Save, then make it the category's default; left out once it already is. */
  onSaveAndSetDefault?: () => void;
  onReset: () => void;
  isNameTaken?: (name: string) => boolean;
  nameError?: string;
  onNameEdited: () => void;
  onTogglePalette: () => void;
  onTogglePanel: () => void;
  paletteOpen: boolean;
  panelOpen: boolean;
}

function IconButton({ label, children, className, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={cn(TOOL_ICON_CLASS, className)} aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Zoom −, Fit and + sit inside one bordered group, edge to edge. */
const ZOOM_BUTTON_CLASS = "h-8 w-8 rounded-none";

const Divider = () => <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />;

export function EditorToolbar({
  onTestPrint,
  onSave,
  canSave = true,
  onSaveAs,
  onSaveAndSetDefault,
  onReset,
  isNameTaken,
  nameError,
  onNameEdited,
  onTogglePalette,
  onTogglePanel,
  paletteOpen,
  panelOpen,
}: EditorToolbarProps) {
  const t = useTranslations("admin.invoiceTemplates.editor");
  const tDraft = useTranslations("admin.invoiceTemplates.draft");
  const api = useEditorApi();
  const category = useEditor((state) => state.category);
  const isDraft = useEditor((state) => state.isDraft);
  const dirty = useEditor(selectIsDirty);
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);
  const zoom = useEditor((state) => state.zoom);
  const zoomMode = useEditor((state) => state.zoomMode);
  const pageView = useEditor((state) => state.pageView);
  const save = useEditor((state) => state.save);
  const saving = save.status === "saving";
  const store = () => api.getState();
  const templateHref = useTemplateScope().href;
  const hasMenu = Boolean(onSaveAs || onSaveAndSetDefault);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-2.5 sm:gap-2 sm:px-4 sm:py-3" data-editor-toolbar="">
      <Button asChild variant="ghost" size="sm" className={cn(TOOL_BUTTON_CLASS, "px-2.5 text-muted-foreground hover:text-foreground")}>
        <Link href={templateHref.list(category)} aria-label={tDraft("back")} data-action="back">
          <ArrowLeft aria-hidden className="rtl:rotate-180" />
          <span className="hidden 2xl:inline">{t("back")}</span>
        </Link>
      </Button>
      <IconButton label={paletteOpen ? t("panels.hidePalette") : t("panels.showPalette")} aria-pressed={paletteOpen} onClick={onTogglePalette}>
        <PanelLeft aria-hidden className="h-4 w-4" />
      </IconButton>

      <div className="flex min-w-0 items-center gap-1.5">
        <TemplateNameField isNameTaken={isNameTaken} serverError={nameError} onEdited={onNameEdited} disabled={saving} />
        {isDraft ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            {tDraft("unsaved")}
          </span>
        ) : dirty ? (
          <span className="inline-flex shrink-0 items-center" data-unsaved-dot="">
            <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="sr-only">{t("unsaved")}</span>
          </span>
        ) : save.status === "saved" ? (
          <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground lg:inline-flex" data-saved="">
            <Check aria-hidden className="h-3.5 w-3.5" />
            {t("save.saved")}
          </span>
        ) : null}
      </div>

      <Divider />
      <div className="flex items-center gap-1">
      <IconButton label={t("undo")} variant="outline" className={TOOL_OUTLINE_ICON_CLASS} disabled={!canUndo} onClick={() => store().undo()} data-action="undo">
        <Undo2 aria-hidden className="h-4 w-4" />
      </IconButton>
      <IconButton label={t("redo")} variant="outline" className={TOOL_OUTLINE_ICON_CLASS} disabled={!canRedo} onClick={() => store().redo()} data-action="redo">
        <Redo2 aria-hidden className="h-4 w-4" />
      </IconButton>
      </div>

      <Divider />
      <SizeMenu />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(TOOL_BUTTON_CLASS, "gap-1 px-2.5")}
            data-action="page-view"
            aria-label={`${t("pageView.label")}: ${t(`pageView.${pageView}`)}`}
          >
            {pageView === "single" ? <File aria-hidden className="h-4 w-4" /> : <Files aria-hidden className="h-4 w-4" />}
            <ChevronDown aria-hidden className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={pageView} onValueChange={(value) => store().setPageView(value as PageView)}>
            <DropdownMenuRadioItem value="single">{t("pageView.single")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="flow">{t("pageView.flow")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className={TOOL_GROUP_CLASS} role="group" aria-label={t("zoom.label")}>
        <IconButton label={t("zoom.out")} className={ZOOM_BUTTON_CLASS} onClick={() => store().setZoom(stepZoom(zoom, -1))} disabled={zoom <= ZOOM_STEPS[0]} data-action="zoom-out">
          <ZoomOut aria-hidden className="h-4 w-4" />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 min-w-12 rounded-none px-1.5 text-xs font-semibold tabular-nums sm:min-w-14" aria-label={t("zoom.menu", { value: Math.round(zoom * 100) })} data-action="zoom-menu">
              {t("zoom.value", { value: Math.round(zoom * 100) })}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {ZOOM_STEPS.map((step) => (
              <DropdownMenuItem key={step} onSelect={() => store().setZoom(step)} data-zoom-step={step}>
                <Check aria-hidden className={zoomMode === "manual" && Math.abs(zoom - step) < 1e-6 ? "opacity-100" : "opacity-0"} />
                {t("zoom.value", { value: Math.round(step * 100) })}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => store().fitToView()}>
              <Check aria-hidden className={zoomMode === "fit" ? "opacity-100" : "opacity-0"} />
              {t("zoom.fit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label={t("zoom.in")} className={ZOOM_BUTTON_CLASS} onClick={() => store().setZoom(stepZoom(zoom, 1))} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} data-action="zoom-in">
          <ZoomIn aria-hidden className="h-4 w-4" />
        </IconButton>
        <IconButton label={t("zoom.fitLabel")} className={cn(ZOOM_BUTTON_CLASS, "border-s border-border")} aria-pressed={zoomMode === "fit"} onClick={() => store().fitToView()} data-action="zoom-fit">
          <Maximize aria-hidden className="h-4 w-4" />
        </IconButton>
      </div>
      <WarningsChip />

      <div className="ms-auto flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className={cn(TOOL_BUTTON_CLASS, "px-2.5 text-muted-foreground hover:text-foreground")} onClick={onReset} data-action="reset" aria-label={t("reset.button")}>
              <RotateCcw aria-hidden />
              <span className="hidden 2xl:inline">{t("reset.button")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("reset.button")}</TooltipContent>
        </Tooltip>
        <Button type="button" variant="outline" size="sm" className={TOOL_BUTTON_CLASS} onClick={onTestPrint} data-action="test-print" aria-label={tDraft("testPrint")}>
          <Printer aria-hidden />
          <span className="hidden lg:inline">{tDraft("testPrint")}</span>
        </Button>
        <div className="flex items-center" data-save-menu="">
          <Button
            type="button"
            size="sm"
            className={cn(TOOL_BUTTON_CLASS, "px-4", hasMenu && "rounded-e-none")}
            onClick={onSave}
            disabled={saving || !canSave}
            aria-busy={saving}
            data-action="save"
          >
            {saving ? <Loader2 aria-hidden className="animate-spin" /> : <Save aria-hidden />}
            {saving ? t("save.saving") : tDraft("save")}
          </Button>
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" className="h-9 rounded-[8px] rounded-s-none border-s border-primary-foreground/25 px-2" disabled={saving || !canSave} aria-label={t("save.more")}>
                  <ChevronDown aria-hidden className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onSave}>{tDraft("save")}</DropdownMenuItem>
                {onSaveAndSetDefault && (
                  <DropdownMenuItem onSelect={onSaveAndSetDefault} data-action="save-set-default">
                    {t("save.saveAndSetDefault")}
                  </DropdownMenuItem>
                )}
                {onSaveAs && (
                  <DropdownMenuItem onSelect={onSaveAs} data-action="save-as">
                    {t("save.saveAs")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <IconButton label={panelOpen ? t("panels.hidePanel") : t("panels.showPanel")} aria-pressed={panelOpen} onClick={onTogglePanel}>
          <PanelRight aria-hidden className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
