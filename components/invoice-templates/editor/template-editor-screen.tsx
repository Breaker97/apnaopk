"use client";

/**
 * The template editor (`/admin/invoice-templates/new` and
 * `/admin/invoice-templates/[id]/edit`, outside the settings layout — docs
 * §4.10, §5.1; a vendor owner's at `/vendor/invoice-templates/…`, Phase 7,
 * on the scope in template-scope.tsx): one card the height of the window,
 * drawn as the Slider editor is (components/admin/sliders/slider-editor.tsx):
 * the toolbar across the top, then three columns. The palette on the left,
 * the canvas in the middle in its own bordered stage with the arrange bar
 * above it, the panel (Design, Layers, Review) on the right; below 1280 px
 * the two sides open as drawers instead.
 *
 * One editor store per open template (`editor-store.ts`). Saving (§5.2,
 * D-17): explicit Save only — a draft's first Save creates the record, later
 * ones PATCH onto the version the editor holds (409 → Reload / Overwrite),
 * Save as… copies, Save & set as default saves and then makes it the category's
 * default (the same route the list's Set as default button calls). Leaving with unsaved changes asks first, and a local copy
 * is kept for recovery. In demo mode the server refuses saves, with a banner
 * that says so (§4.13). `readOnly` (a vendor owner with the view grant but
 * not the edit grant) keeps everything but Save, and says why.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { History, LockKeyhole } from "lucide-react";
import { templatesApiFor } from "@/components/invoice-templates/manager/manager-api";
import { TestPrintDialog } from "@/components/invoice-templates/preview";
import { useTemplateScope } from "@/components/invoice-templates/template-scope";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast-notification";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WarningBanner } from "@/components/ui/warning-banner";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useMediaQuery } from "@/hooks/use-media-query";
import { describeApiError } from "@/lib/api/client";
import type { PaletteItemKey } from "@/lib/invoice-templates/editor/palette";
import {
  TEMPLATE_LIMITS,
  type InvoiceTemplate,
  type TemplateCategory,
  type TemplateDesign,
} from "@/lib/invoice-templates/types";
import { ArrangeBar } from "./arrange-bar";
import { recoveryKey, type RecoveryOwner } from "./draft-recovery";
import { EditorCanvas, type EditorCanvasHandle } from "./editor-canvas";
import { EditorPanel } from "./editor-panel";
import { createEditorStore, EditorStoreProvider, selectIsDirty, useEditor, type EditorInit } from "./editor-store";
import { EditorToolbar } from "./editor-toolbar";
import { ElementPalette } from "./element-palette";
import { ResetDialog } from "./reset-dialog";
import { ConflictDialog, SaveAsDialog } from "./save-dialogs";
import { nameTakenCheck, saveEditorDocument, type SaveOutcome, type SaveRequest } from "./save-flow";
import { SelectionAnnouncer } from "./selection-announcer";
import { useDraftRecovery } from "./use-draft-recovery";
import { useEditorKeyboard } from "./use-editor-keyboard";

export type TemplateEditorSource =
  | {
      kind: "draft";
      category: TemplateCategory;
      design: TemplateDesign;
      presetKey?: string;
      /** A name no other template of this category has. */
      suggestedName: string;
    }
  | { kind: "saved"; template: InvoiceTemplate };

export interface TemplateEditorScreenProps {
  source: TemplateEditorSource;
  /** The server runs in demo mode: saving is refused. */
  demo: boolean;
  /** The caller may look but not save (no permission to change templates): Save is off, with a banner. */
  readOnly?: boolean;
  /** The names the category's other templates have: a rename or Save as… to one of them is refused inline. */
  takenNames?: readonly string[];
  /**
   * The vendor store whose editor this is (the vendor's pages pass it): its
   * unsaved new drafts are kept apart from other stores' on a shared browser.
   * Without it, a vendor's new draft keeps no local copy.
   */
  storeId?: string;
  /** A fixed zoom instead of Fit (tests). */
  initialZoom?: number;
}

/** The sidebars sit beside the canvas from this width; below it they are drawers. */
const WIDE_QUERY = "(min-width: 1280px)";

export function editorInit(source: TemplateEditorSource, zoom?: number): EditorInit {
  if (source.kind === "draft") {
    return {
      category: source.category,
      design: source.design,
      name: source.suggestedName,
      isDraft: true,
      presetKey: source.presetKey ?? null,
      zoom,
    };
  }
  const { template } = source;
  return {
    category: template.category,
    design: { locale: template.locale, canvas: template.canvas, format: template.format, elements: template.elements },
    name: template.name,
    isDraft: false,
    templateId: template.id,
    version: template.version,
    presetKey: template.presetKey ?? null,
    zoom,
  };
}

export function TemplateEditorScreen(props: TemplateEditorScreenProps) {
  const { source } = props;
  // Reload when the server holds the very version this editor opened (a restored older copy was the conflict): start over from it.
  const [generation, setGeneration] = useState(0);
  // Another template (or a newer copy of this one, after Reload) is a fresh editor.
  const key = source.kind === "saved" ? `${source.template.id}:${source.template.version}` : `draft:${source.category}:${source.presetKey ?? ""}`;
  return <EditorRoot key={`${key}:${generation}`} {...props} onRestart={() => setGeneration((count) => count + 1)} />;
}

/** Test print of the design as it is on the canvas now, saved or not. */
function LiveTestPrint({ open, onOpenChange, category }: { open: boolean; onOpenChange: (open: boolean) => void; category: TemplateCategory }) {
  const design = useEditor((state) => state.design);
  const name = useEditor((state) => state.name);
  return <TestPrintDialog open={open} onOpenChange={onOpenChange} design={design} category={category} name={name} />;
}

/** Arms the leave guard while the document is unsaved, and tells when the user is on the way out. */
function LeaveGuard({ onLeave }: { onLeave: () => void }) {
  const t = useTranslations("admin.invoiceTemplates.editor.leave");
  const unsaved = useEditor(selectIsDirty);
  useLeaveGuard(unsaved, { title: t("title"), description: t("description"), confirm: t("confirm"), cancel: t("cancel") }, { onLeave });
  return null;
}

function EditorRoot({ source, demo, readOnly = false, takenNames, storeId, initialZoom, onRestart }: TemplateEditorScreenProps & { onRestart: () => void }) {
  const t = useTranslations("admin.invoiceTemplates.draft");
  const tEditor = useTranslations("admin.invoiceTemplates.editor");
  const tManager = useTranslations("admin.invoiceTemplates.manager");
  const format = useFormatter();
  const router = useRouter();
  const scope = useTemplateScope();
  const templateHref = scope.href;
  const [store] = useState(() => createEditorStore(editorInit(source, initialZoom)));
  const { category } = store.getState();
  const canvasRef = useRef<EditorCanvasHandle | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const isNameTaken = useMemo(() => nameTakenCheck(takenNames ?? []), [takenNames]);
  const owner = useMemo<RecoveryOwner | null>(() => (scope.kind === "admin" ? "admin" : storeId ? { storeId } : null), [scope.kind, storeId]);
  const keyFor = useCallback(
    // A saved template's key is its id; a vendor's new draft needs the store's (otherwise no copy is kept).
    (input: Parameters<typeof recoveryKey>[0]) => (owner || input.templateId ? recoveryKey(input, owner ?? "admin") : null),
    [owner],
  );
  const [initialKey] = useState(() => keyFor(store.getState()));
  const recovery = useDraftRecovery(store, initialKey);
  const handOffRecovery = recovery.handOff;
  // The user has left this editor (a link, Leave, the browser's Back, or it closed): a save that answers later stays where it is.
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);

  const wide = useMediaQuery(WIDE_QUERY);
  const [columns, setColumns] = useState({ palette: true, panel: true });
  const [drawer, setDrawer] = useState<"palette" | "panel" | null>(null);
  const toggle = (side: "palette" | "panel") => {
    if (wide) setColumns((open) => ({ ...open, [side]: !open[side] }));
    else setDrawer((open) => (open === side ? null : side));
  };

  const [nameError, setNameError] = useState<string | undefined>();
  const [saveAsError, setSaveAsError] = useState<string | undefined>();
  const [refused, setRefused] = useState(false);
  const [dialog, setDialog] = useState<"test" | "reset" | "saveAs" | null>(null);
  /** Whether this template is its category's default as far as this editor knows; Save & set as default is offered until it is. */
  const [isDefault, setIsDefault] = useState(source.kind === "saved" && source.template.isDefault);

  /** Adds a palette item centred on a page point, selects it and gives the canvas the keyboard. */
  const addAt = useCallback(
    (key: PaletteItemKey, centre: { xMm: number; yMm: number }) => {
      const id = store.getState().addFromPalette(key, { name: tEditor(`palette.items.${key}`), centre });
      if (!id) {
        toast.error(tEditor("palette.limit", { max: TEMPLATE_LIMITS.elements }));
        return;
      }
      canvasRef.current?.focus();
    },
    [store, tEditor],
  );
  const addAtCentre = useCallback(
    (key: PaletteItemKey) => {
      const { canvas } = store.getState().design;
      addAt(key, canvasRef.current?.viewCentreMm() ?? { xMm: canvas.widthMm / 2, yMm: canvas.heightMm / 2 });
    },
    [addAt, store],
  );

  const focusFirstProperty = useCallback(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-editor-panel-sections] input, [data-position-size] input, input, select, textarea, [tabindex="0"]')?.focus();
  }, []);

  const handle = useCallback(
    (outcome: SaveOutcome, request: SaveRequest) => {
      switch (outcome.type) {
        case "busy":
          return;
        case "invalidName": {
          const message = outcome.reason === "required" ? t("nameRequired") : tEditor("name.taken");
          if (request.kind === "saveAs") setSaveAsError(message);
          else setNameError(message);
          return;
        }
        case "created":
          toast.success(t("saved", { name: outcome.template.name }));
          if (!left.current) router.replace(templateHref.edit(outcome.template.id));
          return;
        case "updated":
          toast.success(t("saved", { name: outcome.template.name }));
          return;
        case "copied":
          toast.success(tEditor("save.copied", { name: outcome.template.name }));
          setDialog(null);
          // The edits went into the copy (handed over in runSave); the open template is left as it was saved.
          if (!left.current) router.push(templateHref.edit(outcome.template.id));
          return;
        case "conflict":
          // The conflict dialog opens from the store's save state.
          return;
        case "refused":
          // The server's own demo text is generic; this says what happened here.
          setRefused(true);
          if (request.kind === "saveAs") setDialog(null);
          return;
        case "nameError":
          if (request.kind === "saveAs") setSaveAsError(outcome.message);
          else setNameError(outcome.message);
          return;
        case "failed":
          toast.error(describeApiError(outcome.error, t("saveFailed")));
          return;
        default:
      }
    },
    [router, t, tEditor, templateHref],
  );

  const runSave = useCallback(
    async (request: SaveRequest, { makeDefault = false }: { makeDefault?: boolean } = {}) => {
      if (readOnly) return;
      if (request.kind === "save") setNameError(undefined);
      else setSaveAsError(undefined);
      setRefused(false);
      const outcome = await saveEditorDocument(store, request, { isNameTaken, endpoint: scope.templatesEndpoint });
      if (outcome.type === "created" || outcome.type === "copied") {
        // What is still unsaved here when the editor closes (edits made while the request was out) goes to the new template.
        const { template } = outcome;
        const key = keyFor({ templateId: template.id, category: template.category, presetKey: template.presetKey ?? null });
        if (key) {
          handOffRecovery({
            key,
            ...(outcome.type === "copied" ? { copy: { version: template.version, design: outcome.design, name: template.name } } : {}),
            carried: !left.current,
          });
        }
      }
      // Only a save that landed is made the default, and before handle() leaves a draft for its saved page.
      let defaultFor: InvoiceTemplate | null = null;
      let defaultFailed: InvoiceTemplate | null = null;
      if (makeDefault && (outcome.type === "created" || outcome.type === "updated")) {
        try {
          await templatesApiFor(scope.templatesEndpoint).setDefault(outcome.template.id);
          defaultFor = outcome.template;
          setIsDefault(true);
        } catch {
          defaultFailed = outcome.template;
        }
      }
      handle(outcome, request);
      if (defaultFor) {
        toast.success(tManager("toast.defaultSet", { name: defaultFor.name, category: tManager(`tabs.${defaultFor.category}`) }));
      } else if (defaultFailed) {
        toast.error(tEditor("save.defaultFailed", { name: defaultFailed.name }));
      }
    },
    [handOffRecovery, handle, isNameTaken, keyFor, readOnly, scope.templatesEndpoint, store, tEditor, tManager],
  );
  const save = useCallback(() => void runSave({ kind: "save" }), [runSave]);
  const saveAndSetDefault = useCallback(() => void runSave({ kind: "save" }, { makeDefault: true }), [runSave]);

  useEditorKeyboard(store, { onEnter: focusFirstProperty, onSave: save });

  const reload = () => {
    const { currentVersion } = store.getState().save;
    store.getState().dispatchSave({ type: "dismiss" });
    recovery.clear();
    router.refresh();
    // Nothing newer to load: the conflict was a restored older copy. Start over from the version open.
    if (source.kind === "saved" && currentVersion === source.template.version) onRestart();
  };

  const banners = { demo: demo && !refused, refused, viewOnly: readOnly && !demo, recovery: recovery.offer };

  return (
    <EditorStoreProvider store={store}>
      <TooltipProvider delayDuration={400}>
        <div
          className="flex h-[calc(100dvh-var(--dashboard-header-height,4rem)-3rem)] min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          data-editor-source={source.kind}
          data-invoice-editor=""
        >
          <EditorToolbar
            onTestPrint={() => setDialog("test")}
            onSave={save}
            canSave={!readOnly}
            onSaveAs={source.kind === "saved" ? () => setDialog("saveAs") : undefined}
            onSaveAndSetDefault={isDefault ? undefined : saveAndSetDefault}
            onReset={() => setDialog("reset")}
            isNameTaken={isNameTaken}
            nameError={nameError}
            onNameEdited={() => setNameError(undefined)}
            onTogglePalette={() => toggle("palette")}
            onTogglePanel={() => toggle("panel")}
            paletteOpen={wide ? columns.palette : drawer === "palette"}
            panelOpen={wide ? columns.panel : drawer === "panel"}
          />

          {(banners.demo || banners.refused || banners.viewOnly || banners.recovery) && (
            <div className="space-y-2 border-b border-border px-3 py-3 sm:px-4">
              {banners.recovery && (
                <WarningBanner
                  icon={History}
                  title={tEditor("recovery.title")}
                  data-recovery-banner=""
                  action={
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={recovery.discard}>
                        {tEditor("recovery.discard")}
                      </Button>
                      <Button type="button" size="sm" onClick={recovery.restore}>
                        {tEditor("recovery.restore")}
                      </Button>
                    </div>
                  }
                >
                  {tEditor("recovery.body", { time: format.dateTime(new Date(banners.recovery.savedAt), { dateStyle: "medium", timeStyle: "short" }) })}
                  {recovery.offerIsStale && <> {tEditor("recovery.stale")} {tEditor("recovery.staleSave")}</>}
                </WarningBanner>
              )}
              {banners.demo && (
                <WarningBanner icon={LockKeyhole} title={t("demoTitle")}>
                  {t("demoBanner")}
                </WarningBanner>
              )}
              {banners.viewOnly && (
                <WarningBanner icon={LockKeyhole} title={t("viewOnlyTitle")} data-view-only-banner="">
                  {t("viewOnlyBody")}
                </WarningBanner>
              )}
              {banners.refused && (
                <WarningBanner icon={LockKeyhole} title={t("refusedTitle")} tone="danger" role="alert">
                  {t("refusedBody")}
                </WarningBanner>
              )}
            </div>
          )}

          {/* The workspace, as the Slider editor lays it out: the stage in
              a bordered card, the palette and the settings beside it on the
              card's own ground. Each column scrolls by itself. */}
          <div className="flex min-h-0 flex-1 px-0 sm:px-1">
            {columns.palette && (
              <aside className="hidden w-60 shrink-0 overflow-y-auto xl:block">
                <ElementPalette onAdd={addAtCentre} />
              </aside>
            )}
            <div className="m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-border sm:m-3 xl:mx-1">
              <ArrangeBar />
              <div data-editor-mount="" className="flex min-h-0 flex-1">
                <EditorCanvas ref={canvasRef} onDropItem={addAt} />
              </div>
            </div>
            {columns.panel && (
              <aside ref={panelRef} className="hidden w-72 shrink-0 overflow-y-auto pt-3 xl:block 2xl:w-80">
                <EditorPanel />
              </aside>
            )}
          </div>

          {!wide && (
            <>
              <Sheet open={drawer === "palette"} onOpenChange={(open) => setDrawer(open ? "palette" : null)}>
                <SheetContent side="left" className="w-72 overflow-y-auto p-0 sm:max-w-xs">
                  <SheetHeader className="sr-only">
                    <SheetTitle>{tEditor("palette.title")}</SheetTitle>
                  </SheetHeader>
                  <ElementPalette
                    onAdd={(key) => {
                      setDrawer(null);
                      addAtCentre(key);
                    }}
                  />
                </SheetContent>
              </Sheet>
              <Sheet open={drawer === "panel"} onOpenChange={(open) => setDrawer(open ? "panel" : null)}>
                <SheetContent side="right" className="w-80 overflow-y-auto p-0 sm:max-w-sm">
                  <SheetHeader className="sr-only">
                    <SheetTitle>{tEditor("panel.title")}</SheetTitle>
                  </SheetHeader>
                  <div ref={panelRef}>
                    <EditorPanel />
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}

          <SelectionAnnouncer />
          <LeaveGuard
            onLeave={() => {
              left.current = true;
            }}
          />
          <LiveTestPrint open={dialog === "test"} onOpenChange={(open) => setDialog(open ? "test" : null)} category={category} />
          <ResetDialog open={dialog === "reset"} onOpenChange={(open) => setDialog(open ? "reset" : null)} />
          {source.kind === "saved" && (
            <SaveAsDialog
              open={dialog === "saveAs"}
              onOpenChange={(open) => setDialog(open ? "saveAs" : null)}
              onSubmit={(name) => void runSave({ kind: "saveAs", name })}
              isNameTaken={isNameTaken}
              serverError={saveAsError}
              onEdited={() => setSaveAsError(undefined)}
            />
          )}
          <ConflictDialog
            restored={recovery.restoredStale}
            onReload={reload}
            onOverwrite={(currentVersion) => void runSave({ kind: "save", overwriteVersion: currentVersion })}
          />
        </div>
      </TooltipProvider>
    </EditorStoreProvider>
  );
}
