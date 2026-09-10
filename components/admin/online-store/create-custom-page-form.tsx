"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor } from "@/components/ui/rich-text-editor-lazy";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { SearchEngineListingPreview } from "@/components/admin/search-engine-listing-preview";
import { PageEditorSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import {
  normalizeContentPagesSettings,
  RESERVED_CONTENT_PAGE_HANDLES,
  slugifyContentPageHandle,
  type ContentPagesSettings,
} from "@/lib/site-config/content-pages-config";
import { isRecord } from "@/lib/utils";

type SettingsResponse = {
  success?: boolean;
  data?: {
    contentPages?: unknown;
  };
};

export function CreateCustomPageForm({ locale }: { locale: string }) {
  const t = useTranslations("admin.customPageForm");
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [content, setContent] = useState("");
  const [visible, setVisible] = useState(true);

  const [existingPages, setExistingPages] = useState<
    ContentPagesSettings["customPages"]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isHandleEdited, setIsHandleEdited] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/admin/settings", { method: "GET" });
        const payload = (await response.json()) as SettingsResponse;

        if (
          !response.ok ||
          payload.success !== true ||
          !isRecord(payload.data)
        ) {
          throw new Error(t("toast.loadSettingsFailed"));
        }

        const normalized = normalizeContentPagesSettings(
          payload.data.contentPages,
        );
        setExistingPages(normalized.customPages);
      } catch {
        toast.error(t("toast.loadExistingFailed"));
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [t]);

  const effectiveHandle = isHandleEdited ? handle : slugifyContentPageHandle(title);

  const handleStatus = useMemo(() => {
    const normalized = slugifyContentPageHandle(effectiveHandle);

    if (!normalized) {
      return { ok: false, message: t("handle.required") };
    }

    if (RESERVED_CONTENT_PAGE_HANDLES.has(normalized)) {
      return {
        ok: false,
        message: t("handle.reserved"),
      };
    }

    const exists = existingPages.some((page) => page.handle === normalized);
    if (exists) {
      return {
        ok: false,
        message: t("handle.exists"),
      };
    }

    return { ok: true, message: t("handle.available") };
  }, [effectiveHandle, existingPages, t]);

  const save = async () => {
    const normalizedHandle = slugifyContentPageHandle(effectiveHandle);

    if (!title.trim()) {
      toast.error(t("toast.titleRequired"));
      return;
    }

    if (!normalizedHandle) {
      toast.error(t("toast.handleRequired"));
      return;
    }

    if (!handleStatus.ok) {
      toast.error(handleStatus.message);
      return;
    }

    try {
      setIsSaving(true);

      const now = new Date().toISOString();
      const nextCustomPages = [
        ...existingPages,
        {
          id: nanoid(12),
          title: title.trim(),
          handle: normalizedHandle,
          content,
          metaTitle: metaTitle.trim(),
          metaDescription: metaDescription.trim(),
          visible,
          createdAt: now,
          updatedAt: now,
        },
      ];

      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "contentPages",
          data: {
            customPages: nextCustomPages,
          },
        }),
      });

      const payload = (await response.json()) as SettingsResponse;
      if (!response.ok || payload.success !== true || !isRecord(payload.data)) {
        throw new Error(t("toast.saveFailed"));
      }

      const normalized = normalizeContentPagesSettings(
        payload.data.contentPages,
      );
      setExistingPages(normalized.customPages);

      toast.success(t("toast.created"));

      setTitle("");
      setHandle("");
      setMetaTitle("");
      setMetaDescription("");
      setContent("");
      setVisible(true);
      setIsHandleEdited(false);
    } catch {
      toast.error(t("toast.createFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  // Same placeholder as `pages/new/loading.tsx`.
  if (isLoading) {
    return <PageEditorSkeleton side="narrow" mainCards={1} actions={2} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button asChild type="button" variant="outline" size="sm">
              <Link href="/admin/online-store/pages">{t("actions.backToPages")}</Link>
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("actions.saving")}
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {t("actions.save")}
                </>
              )}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="rounded-2xl border border-border bg-card p-4 shadow-[0_3px_14px_rgba(15,23,42,0.06)] md:p-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {t("fields.title")}
              </p>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("placeholders.title")}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {t("fields.content")}
              </p>
              <RichTextEditor
                value={content}
                onChange={setContent}
                placeholder={t("placeholders.content")}
                className="min-h-[340px]"
              />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-sm border border-border bg-card p-4 shadow-[0_3px_14px_rgba(15,23,42,0.06)]">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {t("fields.visibility")}
              </p>
              <div className="flex items-center justify-between rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("fields.visibleOnStorefront")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("descriptions.hideDraft")}
                  </p>
                </div>
                <Switch checked={visible} onCheckedChange={setVisible} />
              </div>
            </div>
          </Card>

          <SearchEngineListingPreview
            pageTitle={metaTitle}
            metaDescription={metaDescription}
            handle={effectiveHandle}
            title={title}
            description={content}
            entityLabel={t("seo.entityLabel")}
            emptyTitle={t("seo.emptyTitle")}
            emptyHandle="page-handle"
            pathPrefix={[locale, "pages"]}
            titlePlaceholder={t("seo.titlePlaceholder")}
            metaDescriptionPlaceholder={t("seo.metaDescriptionPlaceholder")}
            handlePlaceholder="page-handle"
            handleFeedback={handleStatus.message}
            handleFeedbackTone={handleStatus.ok ? "success" : "error"}
            defaultEditing
            onPageTitleChange={setMetaTitle}
            onMetaDescriptionChange={setMetaDescription}
            onHandleChange={(value) => {
              setIsHandleEdited(true);
              setHandle(value);
            }}
          />

          <Card className="rounded-2xl border border-border bg-card p-4 shadow-[0_3px_14px_rgba(15,23,42,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t("preview.title")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-10 w-full rounded-xl border-border"
              onClick={() =>
                window.open(
                  `/${locale}/pages/${
                    slugifyContentPageHandle(effectiveHandle) || "your-handle"
                  }`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("preview.open")}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
