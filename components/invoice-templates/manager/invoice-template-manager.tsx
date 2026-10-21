"use client";

/**
 * Settings → Invoice Settings (docs/INVOICE_TEMPLATE_BUILDER.md §5.8): one
 * tab per category (Online Order Invoice, POS Invoice, Sticker), each with its
 * own templates and its own default. Cards show a live thumbnail drawn by the
 * renderer; every action calls its route, then the list is read again, so the
 * Default badge always shows what the server holds. Each tab reads as a
 * document app's template gallery (owner, 2026-10-13): a blank page first
 * (blank-card.tsx), then the standard print — the store's own invoice or
 * receipt, the Default while no template is — then the saved templates, then
 * the presets none of them was made from (preset-card.tsx). A preset's Set as
 * default saves it, then makes it the default; the standard print's removes
 * the default, so the standard print is used again.
 *
 * `readOnly` (demo mode, or settings still loading) switches off only what
 * changes data. The tabs, New (an unsaved draft), Edit and Preview keep
 * working, as §4.13 asks — on a preset's card too.
 *
 * The scope (template-scope.tsx) picks the routes and links: the admin's
 * platform templates, or a vendor owner's own (Phase 7). A vendor without a
 * default of their own prints with the platform's, so the few sentences
 * about "no default" say that on the vendor's side (`manager.vendor.*`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Globe, Monitor, RotateCw, Star, StarOff, Sticker, TriangleAlert, type LucideIcon } from "lucide-react";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/admin/underline-tabs";
import { rendererStylesheet } from "@/components/invoice-templates/renderer/template-renderer";
import { Button } from "@/components/ui/button";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { InputDialog, type InputDialogValues } from "@/components/ui/input-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast-notification";
import { ApiClientError, describeApiError } from "@/lib/api/client";
import { freeTemplateName, templateNameKey } from "@/lib/invoice-templates/draft-name";
import {
  isStandardPreset,
  presetName,
  presetsFor,
  STANDARD_PRESETS,
  TEMPLATE_PRESETS,
  type PresetKey,
} from "@/lib/invoice-templates/presets";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIMITS,
  type InvoiceTemplate,
  type TemplateCategory,
} from "@/lib/invoice-templates/types";
import { cn } from "@/lib/utils";
import { useTemplateScope } from "../template-scope";
import { BlankCard } from "./blank-card";
import { CARD_CLASS, PAGE_ACTION_CLASS, PILL_BUTTON_CLASS, TEMPLATE_GRID_CLASS } from "./card-styles";
import { templatesApiFor } from "./manager-api";
import { NewTemplateButton, useDraftLanguage } from "./new-template-button";
import { PresetCard, type PresetAction } from "./preset-card";
import { TemplateCard, type TemplateAction } from "./template-card";

export interface InvoiceTemplateManagerProps {
  /** Demo mode: nothing that changes data can be started. */
  readOnly?: boolean;
}

type LoadState = "loading" | "ready" | "error";

/** Each tab's icon, as the admin's other underline tabs carry one. */
const CATEGORY_ICONS: Record<TemplateCategory, LucideIcon> = {
  online: Globe,
  pos: Monitor,
  sticker: Sticker,
};

const isCategory = (value: string | null | undefined): value is TemplateCategory =>
  Boolean(value) && (TEMPLATE_CATEGORIES as readonly string[]).includes(value as string);

export function InvoiceTemplateManager({ readOnly = false }: InvoiceTemplateManagerProps) {
  const t = useTranslations("admin.invoiceTemplates.manager");
  const { confirm } = useConfirmation();
  const searchParams = useSearchParams();
  const scope = useTemplateScope();
  const lang = useDraftLanguage();
  const templatesApi = useMemo(() => templatesApiFor(scope.templatesEndpoint), [scope.templatesEndpoint]);
  /** A sentence the vendor's side words differently (their prints fall back to the platform's default). */
  const own = useCallback((key: string) => (scope.kind === "vendor" ? `vendor.${key}` : key), [scope.kind]);

  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [category, setCategory] = useState<TemplateCategory>(() => {
    const asked = searchParams?.get("category");
    return isCategory(asked) ? asked : "online";
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<InvoiceTemplate | null>(null);
  const [renameValues, setRenameValues] = useState<InputDialogValues>({ name: "" });
  const [renameError, setRenameError] = useState<string | undefined>();
  const [renameBusy, setRenameBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Reads the list. `quiet` keeps the cards on screen while it runs. */
  const reload = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoadState("loading");
      try {
        const list = await templatesApi.list();
        if (!mounted.current) return;
        setTemplates(list);
        setLoadState("ready");
      } catch (error) {
        if (!mounted.current) return;
        if (quiet) toast.error(describeApiError(error, t("toast.loadFailed")));
        else setLoadState("error");
      }
    },
    [t, templatesApi],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const changeCategory = (next: string) => {
    if (!isCategory(next)) return;
    setCategory(next);
    // Mirrored into the URL so Back from the editor lands on the same tab.
    const params = new URLSearchParams(window.location.search);
    params.set("category", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  const byCategory = useMemo(() => {
    const groups: Record<TemplateCategory, InvoiceTemplate[]> = { online: [], pos: [], sticker: [] };
    for (const template of templates) groups[template.category]?.push(template);
    return groups;
  }, [templates]);

  /** Wording for a failed action; a vanished or changed template also refreshes the list. */
  const failed = useCallback(
    (error: unknown) => {
      if (error instanceof ApiClientError && error.status === 409) {
        toast.error(t("toast.conflict"));
        void reload(true);
      } else if (error instanceof ApiClientError && error.status === 404) {
        toast.error(t("toast.gone"));
        void reload(true);
      } else {
        toast.error(describeApiError(error, t("toast.failed")));
      }
    },
    [reload, t],
  );

  const run = useCallback(
    async (template: InvoiceTemplate, work: () => Promise<void>) => {
      setBusyId(template.id);
      try {
        await work();
        await reload(true);
      } catch (error) {
        failed(error);
      } finally {
        if (mounted.current) setBusyId(null);
      }
    },
    [failed, reload],
  );

  const categoryName = useCallback((value: TemplateCategory) => t(`tabs.${value}`), [t]);

  const onAction = useCallback(
    async (action: TemplateAction, template: InvoiceTemplate) => {
      const categoryLabel = categoryName(template.category);
      switch (action) {
        case "rename":
          setRenameValues({ name: template.name });
          setRenameError(undefined);
          setRenaming(template);
          return;
        case "duplicate":
          return run(template, async () => {
            const copy = await templatesApi.duplicate(template.id);
            toast.success(t("toast.duplicated", { name: copy.name }));
          });
        case "setDefault":
          return run(template, async () => {
            await templatesApi.setDefault(template.id);
            toast.success(t("toast.defaultSet", { name: template.name, category: categoryLabel }));
          });
        case "removeDefault":
          return run(template, async () => {
            await templatesApi.removeDefault(template.id);
            toast.success(t(own("toast.defaultRemoved"), { name: template.name, category: categoryLabel }));
          });
        case "restorePreset": {
          const ok = await confirm({
            type: "warning",
            title: t("confirm.restoreTitle"),
            description: t("confirm.restoreDescription", { name: template.name }),
            confirmText: t("actions.restorePreset"),
            cancelText: t("actions.cancel"),
          });
          if (!ok) return;
          return run(template, async () => {
            await templatesApi.restorePreset(template);
            toast.success(t("toast.restored", { name: template.name }));
          });
        }
        case "delete": {
          const ok = await confirm({
            type: "danger",
            title: t("confirm.deleteTitle"),
            description: template.isDefault
              ? t(own("confirm.deleteDefaultDescription"), { name: template.name, category: categoryLabel })
              : t("confirm.deleteDescription", { name: template.name }),
            confirmText: t("actions.delete"),
            cancelText: t("actions.cancel"),
            variant: "destructive",
          });
          if (!ok) return;
          return run(template, async () => {
            const result = await templatesApi.remove(template.id);
            toast.success(
              result.wasDefault
                ? t(own("toast.deletedDefault"), { name: template.name, category: categoryLabel })
                : t("toast.deleted", { name: template.name }),
            );
          });
        }
      }
    },
    [categoryName, confirm, own, run, t, templatesApi],
  );

  /**
   * A preset saved as a template under the first free name; Set as default then
   * makes it the default. The standard print's Set as default saves nothing: it
   * removes the template default, so the standard print is used again.
   */
  const onPresetAction = useCallback(
    async (action: PresetAction, presetKey: PresetKey) => {
      const presetCategory = TEMPLATE_PRESETS[presetKey].category;
      if (action === "setDefault" && isStandardPreset(presetKey)) {
        const current = byCategory[presetCategory].find((template) => template.isDefault);
        if (!current) return;
        setBusyId(`preset:${presetKey}`);
        try {
          await templatesApi.removeDefault(current.id);
          toast.success(
            t("toast.defaultSet", { name: presetName(presetKey, lang), category: categoryName(presetCategory) }),
          );
          await reload(true);
        } catch (error) {
          failed(error);
        } finally {
          if (mounted.current) setBusyId(null);
        }
        return;
      }
      const taken = new Set(byCategory[presetCategory].map((template) => templateNameKey(template.name)));
      const name = freeTemplateName(presetName(presetKey, lang), (candidate) => taken.has(templateNameKey(candidate)));
      setBusyId(`preset:${presetKey}`);
      let saved = false;
      try {
        const created = await templatesApi.createFromPreset({ category: presetCategory, name, presetKey, locale: lang });
        saved = true;
        if (action === "setDefault") {
          await templatesApi.setDefault(created.id);
          toast.success(t("toast.defaultSet", { name: created.name, category: categoryName(presetCategory) }));
        } else {
          toast.success(t("toast.created", { name: created.name }));
        }
      } catch (error) {
        failed(error);
      } finally {
        // Saved before a failed Set as default, it is a template now all the same.
        if (saved) await reload(true);
        if (mounted.current) setBusyId(null);
      }
    },
    [byCategory, categoryName, failed, lang, reload, t, templatesApi],
  );

  const submitRename = async () => {
    if (!renaming) return;
    const name = (renameValues.name ?? "").trim();
    if (!name) return setRenameError(t("rename.required"));
    if (name.length > TEMPLATE_LIMITS.nameLength) {
      return setRenameError(t("rename.tooLong", { max: TEMPLATE_LIMITS.nameLength }));
    }
    if (name === renaming.name) return setRenaming(null);
    setRenameBusy(true);
    setRenameError(undefined);
    try {
      await templatesApi.rename(renaming, name);
      toast.success(t("toast.renamed", { name }));
      setRenaming(null);
      await reload(true);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 400 && error.errors?.name?.[0]) {
        // A duplicate name, said beside the field.
        setRenameError(error.errors.name[0]);
      } else {
        setRenaming(null);
        failed(error);
      }
    } finally {
      if (mounted.current) setRenameBusy(false);
    }
  };

  const activeList = byCategory[category];
  const activeFull = activeList.length >= TEMPLATE_LIMITS.templatesPerCategory;

  return (
    <div className="space-y-4">
      {/* The renderer's stylesheet, once for every thumbnail on the page. */}
      <style dangerouslySetInnerHTML={{ __html: rendererStylesheet() }} />

      {/* The Sliders page's header: the title and what the page is for, the
          main action beside them. New starts a template in the open tab. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(own("description"))}</p>
        </div>
        <NewTemplateButton
          category={category}
          disabled={loadState !== "ready" || activeFull}
          className={PAGE_ACTION_CLASS}
        />
      </div>

      <Tabs value={category} onValueChange={changeCategory} className="gap-4">
        <UnderlineTabsList aria-label={t("title")}>
          {TEMPLATE_CATEGORIES.map((value) => (
            <UnderlineTabsTrigger key={value} value={value} icon={CATEGORY_ICONS[value]}>
              {categoryName(value)}
            </UnderlineTabsTrigger>
          ))}
        </UnderlineTabsList>

        {TEMPLATE_CATEGORIES.map((value) => {
          const list = byCategory[value];
          const current = list.find((template) => template.isDefault);
          const full = list.length >= TEMPLATE_LIMITS.templatesPerCategory;
          const standard = STANDARD_PRESETS[value];
          // Without a template default the admin's prints are the standard print; a vendor's go to the marketplace's default first.
          const standardIsDefault = Boolean(standard) && !current && scope.kind !== "vendor";
          const defaultName = current?.name ?? (standardIsDefault && standard ? presetName(standard, lang) : null);
          const presets = presetsFor(value).filter(
            (preset) => !isStandardPreset(preset.key) && !list.some((template) => template.presetKey === preset.key),
          );
          return (
            <TabsContent key={value} value={value} className="space-y-4" data-category={value}>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{t(own(`hints.${value}`))}</p>
                {loadState === "ready" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                    <p
                      className={cn(
                        "inline-flex min-w-0 items-start gap-2",
                        defaultName ? "text-foreground" : "text-muted-foreground",
                      )}
                      data-default-status={current ? "set" : standardIsDefault ? "standard" : "none"}
                    >
                      {defaultName ? (
                        <Star aria-hidden className="mt-0.5 h-4 w-4 shrink-0 fill-primary text-primary" />
                      ) : (
                        <StarOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <span>{defaultName ? t("defaultStatus", { name: defaultName }) : t(own("noDefaultStatus"))}</span>
                    </p>
                    {full && (
                      <p className="text-xs text-muted-foreground">
                        {t("limitReached", { max: TEMPLATE_LIMITS.templatesPerCategory })}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {loadState === "loading" && (
                <div className={TEMPLATE_GRID_CLASS} aria-busy="true" aria-label={t("loading")}>
                  {[0, 1, 2].map((index) => (
                    <div key={index} className={CARD_CLASS}>
                      <Skeleton className="mb-3 h-8 w-36" />
                      <Skeleton className="h-[15.5rem] w-full rounded-xl" />
                      <Skeleton className="mt-3 h-3 w-40" />
                      <Skeleton className="mt-6 h-8 w-full rounded-full" />
                    </div>
                  ))}
                </div>
              )}

              {loadState === "error" && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm sm:p-5"
                >
                  <TriangleAlert aria-hidden className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1">{t("loadError")}</span>
                  <Button size="sm" variant="outline" className={PILL_BUTTON_CLASS} onClick={() => void reload()}>
                    <RotateCw aria-hidden />
                    {t("actions.retry")}
                  </Button>
                </div>
              )}

              {loadState === "ready" && (
                <div className={TEMPLATE_GRID_CLASS}>
                  <BlankCard category={value} disabled={full} />
                  {standard && (
                    <PresetCard
                      presetKey={standard}
                      category={value}
                      readOnly={readOnly}
                      full={full}
                      busy={busyId === `preset:${standard}`}
                      standard={{ isDefault: standardIsDefault, canSetDefault: scope.kind !== "vendor" }}
                      onAction={onPresetAction}
                    />
                  )}
                  {list.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      readOnly={readOnly}
                      busy={busyId === template.id}
                      onAction={onAction}
                    />
                  ))}
                  {presets.map((preset) => (
                    <PresetCard
                      key={preset.key}
                      presetKey={preset.key}
                      category={value}
                      readOnly={readOnly}
                      full={full}
                      busy={busyId === `preset:${preset.key}`}
                      onAction={onPresetAction}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <InputDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open && !renameBusy) setRenaming(null);
        }}
        title={t("rename.title")}
        fields={[{ name: "name", label: t("rename.label") }]}
        values={renameValues}
        onValuesChange={(values) => {
          setRenameValues(values);
          setRenameError(undefined);
        }}
        onSubmit={() => void submitRename()}
        submitText={t("actions.rename")}
        cancelText={t("actions.cancel")}
        loading={renameBusy}
        errors={{ name: renameError }}
      />
    </div>
  );
}
