"use client";

import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  MediaUploader,
  type UploadedMedia,
} from "@/components/ui/media-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/ui/rich-text-editor-lazy";
import { toast } from "@/components/ui/toast-notification";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import {
  SearchEngineListingPreview,
  generateSearchHandle,
  sanitizeSearchHandle,
} from "@/components/admin/search-engine-listing-preview";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { AiStudioImageField } from "@/components/ai-authoring/ai-studio-image-field";
import {
  BLOG_FEATURED_GENERATE_DEFAULTS,
  BLOG_FEATURED_PROMPT_PLACEHOLDER,
  cropBlogFeaturedResult,
} from "@/components/ai-authoring/blog-featured-ai-studio";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import type {
  AIAuthoringRequest,
  AIAuthoringSeoDraft,
} from "@/lib/ai-authoring/types";

const postSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  slug: z.string().optional(),
  excerpt: z.string().max(500).optional(),
  content: z.string().min(1, "Content is required"),
  featuredImage: z
    .object({
      url: z.string().optional(),
      alt: z.string().optional(),
    })
    .optional(),
  categoryIds: z.array(z.string()),
  tags: z.array(z.string()),
  status: z.enum(["draft", "scheduled", "published", "archived"]),
  visibility: z.enum(["public", "private", "password"]),
  password: z.string().optional(),
  scheduledFor: z.string().optional(),
  publishedAt: z.string().optional(),
  allowComments: z.boolean(),
  isFeatured: z.boolean(),
  seo: z
    .object({
      pageTitle: z.string().max(70).optional(),
      metaDescription: z.string().max(320).optional(),
    })
    .optional(),
});

// AI authoring bounds. The excerpt mirrors the schema above (and the model's own
// 500 cap) so a generated value never trips validation on save. Content has no
// schema bound, so it follows the server-side clamp instead: the authoring layer
// caps constraints.maxLength and clips generated fields at 5000 either way, and
// stating that ceiling up front beats letting a longer draft be truncated.
const EXCERPT_MIN_CHARS = 50;
const EXCERPT_MAX_CHARS = 500;
const CONTENT_MIN_CHARS = 50;
const CONTENT_MAX_CHARS = 5000;

type FormData = z.infer<typeof postSchema>;

interface CategoryOption {
  _id: string;
  name: string;
}

interface Props {
  postId?: string;
}

function firstErrorMessage(errors: unknown): string | undefined {
  if (!errors || typeof errors !== "object") return undefined;
  const node = errors as Record<string, unknown>;
  const message = node.message;
  if (typeof message === "string" && message.trim()) return message;
  for (const key of Object.keys(node)) {
    if (key === "ref" || key === "type") continue;
    const found = firstErrorMessage(node[key]);
    if (found) return found;
  }
  return undefined;
}

function isoLocal(date: Date | string | undefined) {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60000);
  return local.toISOString().slice(0, 16);
}

export function BlogPostForm({ postId }: Props) {
  const t = useTranslations("admin.blogPostForm");
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = typeof params.locale === "string" ? params.locale : "en";
  const basePath = `/${locale}/admin/content/blog-posts`;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(!!postId);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [postSlug, setPostSlug] = useState("");
  const slugManuallyEditedRef = useRef(false);

  const form = useForm<FormData>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      title: "",
      slug: "",
      excerpt: "",
      content: "",
      featuredImage: { url: "", alt: "" },
      categoryIds: [],
      tags: [],
      status: "draft",
      visibility: "public",
      password: "",
      scheduledFor: "",
      publishedAt: "",
      allowComments: true,
      isFeatured: false,
      seo: { pageTitle: "", metaDescription: "" },
    },
  });

  useEffect(() => {
    (async () => {
      try {
        const catRes = await fetch("/api/blog-categories");
        const catJson = await catRes.json();
        if (catJson.success) setCategories(catJson.data);
      } catch {
        toast.error(t("toast.loadCategoriesFailed"));
      }
    })();
  }, [t]);

  useEffect(() => {
    if (!postId) return;
    (async () => {
      setIsFetching(true);
      try {
        const res = await fetch(`/api/blog-posts/${postId}`);
        const data = await res.json();
        if (data.success && data.data) {
          const p = data.data;
          setPostSlug(p.slug || "");
          // Existing posts keep their established slug; don't auto-rewrite it
          // from the title (would break links / SEO). Exception: legacy
          // auto-generated placeholder slugs (e.g. "post-slug-1779016098380")
          // are treated as not customized, so they re-derive from the title.
          const isPlaceholderSlug = /^post-slug(-\d+)?$/.test(p.slug || "");
          slugManuallyEditedRef.current =
            Boolean(p.slug) && !isPlaceholderSlug;
          form.reset({
            title: p.title,
            slug: p.slug,
            excerpt: p.excerpt || "",
            content: p.content || "",
            featuredImage: p.featuredImage || { url: "", alt: "" },
            categoryIds: (p.categoryIds || []).map((c: { _id?: string } | string) =>
              typeof c === "string" ? c : (c?._id ?? ""),
            ),
            tags: p.tags || [],
            status: p.status,
            visibility: p.visibility,
            password: p.password || "",
            scheduledFor: isoLocal(p.scheduledFor),
            publishedAt: isoLocal(p.publishedAt),
            allowComments: p.allowComments,
            isFeatured: p.isFeatured,
            seo: {
              pageTitle: p.seo?.pageTitle || "",
              metaDescription: p.seo?.metaDescription || "",
            },
          });
        }
      } catch {
        toast.error(t("toast.loadPostFailed"));
      } finally {
        setIsFetching(false);
      }
    })();
  }, [postId, form, t]);

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      const url = postId ? `/api/blog-posts/${postId}` : "/api/blog-posts";
      const method = postId ? "PUT" : "POST";

      const payload: Record<string, unknown> = { ...data };
      if (data.publishedAt) payload.publishedAt = new Date(data.publishedAt).toISOString();
      if (data.scheduledFor) payload.scheduledFor = new Date(data.scheduledFor).toISOString();

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        toast.success(postId ? t("toast.updated") : t("toast.created"));
        router.push(basePath);
      } else {
        toast.error(result.message || result.error || t("toast.saveFailed"));
      }
    } catch {
      toast.error(t("toast.genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  const onInvalid = (errors: FieldErrors<FormData>) => {
    toast.error(
      firstErrorMessage(errors) ||
        t("toast.fixHighlighted"),
    );
  };

  const watchedTitle = useWatch({ control: form.control, name: "title" }) || "";
  const watchedStatus = useWatch({ control: form.control, name: "status" }) || "draft";
  const watchedVisibility = useWatch({ control: form.control, name: "visibility" });
  const watchedTags = useWatch({ control: form.control, name: "tags" }) || [];
  const watchedSeoTitle = useWatch({ control: form.control, name: "seo.pageTitle" }) || "";
  const watchedSeoDesc = useWatch({ control: form.control, name: "seo.metaDescription" }) || "";
  const watchedContent = useWatch({ control: form.control, name: "content" }) || "";
  const watchedExcerpt = useWatch({ control: form.control, name: "excerpt" }) || "";
  const watchedSlug = useWatch({ control: form.control, name: "slug" }) || "";
  const watchedImageAlt =
    useWatch({ control: form.control, name: "featuredImage.alt" }) || "";

  // Keep the URL handle in sync with the title until it is edited by hand.
  useEffect(() => {
    if (slugManuallyEditedRef.current) return;
    const next = generateSearchHandle(watchedTitle);
    if (next && next !== watchedSlug) {
      form.setValue("slug", next, { shouldDirty: true });
    }
  }, [watchedTitle, watchedSlug, form]);

  const addTag = () => {
    const v = tagInput.trim().toLowerCase();
    if (!v) return;
    if (!watchedTags.includes(v)) {
      form.setValue("tags", [...watchedTags, v]);
    }
    setTagInput("");
  };

  const removeTag = (t: string) => {
    form.setValue(
      "tags",
      watchedTags.filter((x) => x !== t),
    );
  };

  const toggleCategory = (id: string) => {
    const current = form.getValues("categoryIds") || [];
    form.setValue(
      "categoryIds",
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  };

  const watchedCategoryIds = useWatch({ control: form.control, name: "categoryIds" }) || [];

  // Blog posts are admin-only, so the content endpoint is always the admin one
  // (no vendor variant like the product/brand forms have).
  const aiAuthoring = useAiAuthoring({
    contentEndpoint: "/api/admin/ai-authoring/content",
  });

  // Context handed to the model on every generate — read fresh so edits made
  // just before opening the menu are included. Categories go as names, not ids,
  // since the ids mean nothing to the model.
  const getPostAuthoringFields = () => ({
    title: watchedTitle,
    excerpt: watchedExcerpt,
    content: watchedContent,
    tags: watchedTags,
    categories: watchedCategoryIds
      .map((id) => categories.find((category) => category._id === id)?.name)
      .filter((name): name is string => Boolean(name)),
  });

  const ensureTitleForAI = () => {
    if (watchedTitle.trim()) return true;
    toast.error(t("toast.titleRequiredForAi"));
    return false;
  };

  const excerptRequest: AIAuthoringRequest = {
    entity: "blog_post",
    operation: "summary",
    locale,
    targetField: "excerpt",
    fields: getPostAuthoringFields(),
    constraints: {
      maxLength: EXCERPT_MAX_CHARS,
      audience: "shopper",
    },
  };

  const contentRequest: AIAuthoringRequest = {
    entity: "blog_post",
    operation: "rich_content",
    locale,
    targetField: "content",
    fields: getPostAuthoringFields(),
    constraints: {
      html: true,
      maxLength: CONTENT_MAX_CHARS,
      audience: "shopper",
    },
  };

  const seoRequest: AIAuthoringRequest = {
    entity: "blog_post",
    operation: "seo",
    locale,
    targetField: "seo",
    fields: getPostAuthoringFields(),
    constraints: {
      audience: "shopper",
    },
  };

  const generateExcerptDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("post-excerpt", request);
    if (typeof draft?.fields.excerpt === "string") return draft.fields.excerpt;
    if (typeof draft?.fields.summary === "string") return draft.fields.summary;
    return null;
  };

  const generateContentDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("post-content", request);
    if (typeof draft?.fields.content === "string") return draft.fields.content;
    if (typeof draft?.fields.description === "string")
      return draft.fields.description;
    return null;
  };

  // Long-form body streams so the writer sees progress instead of a spinner.
  const generateContentDraftStream = async (
    request: AIAuthoringRequest,
    onDelta: (text: string) => void,
  ) => {
    const draft = await aiAuthoring.generateContentStream(
      "post-content",
      request,
      onDelta,
    );
    if (typeof draft?.fields.content === "string") return draft.fields.content;
    if (typeof draft?.fields.description === "string")
      return draft.fields.description;
    return null;
  };

  const generateSeoDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("post-seo", request);
    return draft?.seo ?? null;
  };

  if (isFetching) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const previewSlug = (form.getValues("slug") || postSlug || "").toLowerCase();

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="mx-auto w-full max-w-6xl space-y-6"
      >
        <AdminFormStickyHeader
          className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
          title={watchedTitle || (postId ? t("editTitle") : t("addTitle"))}
          status={
            <Badge
              variant={watchedStatus === "published" ? "default" : "outline"}
              className="capitalize"
            >
              {t(`status.${watchedStatus}`)}
            </Badge>
          }
          actions={
            <>
              {postId && previewSlug ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href={`/${locale}/blog/${previewSlug}`} target="_blank">
                    <ExternalLink className="mr-1.5 h-4 w-4" />
                    {t("actions.preview")}
                  </Link>
                </Button>
              ) : null}
              <Button type="submit" disabled={isLoading} size="sm">
                {isLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {t("actions.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.back()}
                className="shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("actions.back")}
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>{t("sections.titleContent")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.title")} *</FormLabel>
                      <FormControl>
                        <Input placeholder={t("placeholders.title")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.urlHandle")}</FormLabel>
                      <FormControl>
                        <div className="flex items-center">
                          <span className="mr-1 whitespace-nowrap text-sm text-muted-foreground">
                            blog/
                          </span>
                          <Input
                            placeholder="my-post"
                            className="min-w-0 flex-1"
                            value={field.value || ""}
                            onChange={(e) => {
                              slugManuallyEditedRef.current = true;
                              field.onChange(
                                sanitizeSearchHandle(e.target.value),
                              );
                            }}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        {t("descriptions.urlHandle")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="excerpt"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel>{t("fields.excerpt")}</FormLabel>
                        <AiGenerateMenu
                          label={t("actions.generate")}
                          placeholder={t("placeholders.generateExcerpt")}
                          minChars={EXCERPT_MIN_CHARS}
                          maxChars={EXCERPT_MAX_CHARS}
                          request={excerptRequest}
                          loading={aiAuthoring.isLoading("post-excerpt")}
                          canOpen={ensureTitleForAI}
                          onGenerate={generateExcerptDraft}
                          onApply={(value) =>
                            form.setValue("excerpt", value, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        />
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder={t("placeholders.excerpt")}
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("descriptions.characters", {
                          count: field.value?.length || 0,
                          max: 500,
                        })}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel>{t("fields.content")} *</FormLabel>
                        <AiGenerateMenu
                          label={t("actions.generate")}
                          placeholder={t("placeholders.generateContent")}
                          format="html"
                          minChars={CONTENT_MIN_CHARS}
                          maxChars={CONTENT_MAX_CHARS}
                          request={contentRequest}
                          loading={aiAuthoring.isLoading("post-content")}
                          canOpen={ensureTitleForAI}
                          onGenerate={generateContentDraft}
                          onGenerateStream={generateContentDraftStream}
                          onApply={(value) =>
                            form.setValue("content", value, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        />
                      </div>
                      <FormControl>
                        <RichTextEditor
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t("placeholders.content")}
                          imageStudioSlot={(insertImage) => (
                            <AiStudioImageField
                              entity="blog_post"
                              scope="admin"
                              locale={locale}
                              targetField="content"
                              audience="shopper"
                              getFields={getPostAuthoringFields}
                              // Not bound to a single field value — every save
                              // inserts a new image at the cursor instead of
                              // replacing one. Free-form media surface (no ratio
                              // lock) so in-body images can be any size.
                              value=""
                              onChange={(url, alt) => {
                                if (url) insertImage(url, alt);
                              }}
                              breadcrumbRoot={
                                postId ? t("editTitle") : t("addTitle")
                              }
                              breadcrumbLeaf={t("ai.contentImage")}
                              savedMessage={t("ai.contentImageSaved")}
                              subjectNoun={t("ai.image")}
                              posHref={`/${locale}/admin/pos`}
                              browseHref={`/${locale}`}
                              persistKey={`blog_post:admin:${postId ?? "new"}:content-image`}
                            >
                              {(open) => (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={open}
                                  className="h-8 w-8 p-0"
                                  title={t("ai.addImage")}
                                >
                                  <Sparkles className="h-4 w-4" />
                                </Button>
                              )}
                            </AiStudioImageField>
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>{t("sections.featuredImage")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="featuredImage.url"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <MediaUploader
                          maxFiles={1}
                          acceptTypes={["image"]}
                          value={
                            field.value
                              ? [
                                  {
                                    _id: "existing",
                                    url: field.value,
                                    type: "image",
                                    mimeType: "image/*",
                                    alt: form.getValues("featuredImage.alt") || undefined,
                                    position: 0,
                                  } as UploadedMedia,
                                ]
                              : []
                          }
                          onChange={(items) => {
                            const img = items.find((i) => i.type === "image");
                            field.onChange(img?.url || "");
                          }}
                          aiGenerateAction={
                            <AiStudioImageField
                              entity="blog_post"
                              scope="admin"
                              locale={locale}
                              targetField="featuredImage"
                              audience="shopper"
                              getFields={getPostAuthoringFields}
                              value={field.value || ""}
                              alt={watchedImageAlt || watchedTitle || undefined}
                              onChange={(url, alt) => {
                                field.onChange(url);
                                // The studio derives alt from the post title, so
                                // it is never a better description than one the
                                // author typed into the visible field below —
                                // only fill a blank, never overwrite.
                                if (url && alt && !watchedImageAlt) {
                                  form.setValue("featuredImage.alt", alt, {
                                    shouldDirty: true,
                                  });
                                }
                              }}
                              breadcrumbRoot={
                                postId ? t("editTitle") : t("addTitle")
                              }
                              breadcrumbLeaf={t("sections.featuredImage")}
                              savedMessage={t("ai.featuredImageSaved")}
                              subjectNoun={t("ai.photo")}
                              surface="blog_featured"
                              generateDefaults={BLOG_FEATURED_GENERATE_DEFAULTS}
                              postProcessResult={cropBlogFeaturedResult}
                              promptPlaceholder={BLOG_FEATURED_PROMPT_PLACEHOLDER}
                              posHref={`/${locale}/admin/pos`}
                              browseHref={`/${locale}`}
                              persistKey={`blog_post:admin:${postId ?? "new"}:featuredImage`}
                            />
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="featuredImage.alt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.imageAlt")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("placeholders.imageAlt")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <SearchEngineListingPreview
              pageTitle={watchedSeoTitle}
              metaDescription={watchedSeoDesc}
              handle={watchedSlug}
              title={watchedTitle}
              description={watchedExcerpt || watchedContent}
              entityLabel={t("seo.entityLabel")}
              emptyTitle={t("seo.emptyTitle")}
              emptyDescription={t("seo.emptyDescription")}
              emptyHandle="post-slug"
              pathPrefix="blog"
              handlePlaceholder="my-post"
              titleMaxChars={70}
              descriptionMaxChars={320}
              defaultEditing
              aiGenerateAction={
                <AiGenerateMenu<AIAuthoringSeoDraft>
                  label={t("actions.improveSeo")}
                  placeholder={t("placeholders.improveSeo")}
                  allowAttachment={false}
                  request={seoRequest}
                  loading={aiAuthoring.isLoading("post-seo")}
                  canOpen={ensureTitleForAI}
                  onGenerate={generateSeoDraft}
                  previewText={(draft) =>
                    [draft.pageTitle, draft.metaDescription]
                      .filter(Boolean)
                      .join("\n")
                  }
                  onApply={(draft) => {
                    if (draft.pageTitle) {
                      form.setValue("seo.pageTitle", draft.pageTitle, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                    if (draft.metaDescription) {
                      form.setValue("seo.metaDescription", draft.metaDescription, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                    // Unlike the other forms the handle lives outside `seo`, in
                    // the post's own slug field. Applying one counts as editing
                    // it by hand — without the flag the title-sync effect below
                    // would immediately overwrite whatever the AI proposed.
                    const handle = draft.handle || draft.slug;
                    if (handle) {
                      slugManuallyEditedRef.current = true;
                      form.setValue("slug", sanitizeSearchHandle(handle), {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                  }}
                />
              }
              onPageTitleChange={(value) =>
                form.setValue("seo.pageTitle", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onMetaDescriptionChange={(value) =>
                form.setValue("seo.metaDescription", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onHandleChange={(value) => {
                slugManuallyEditedRef.current = true;
                form.setValue("slug", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            />
          </div>

          <div className="space-y-4">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>{t("sections.visibility")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.status")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="draft">{t("status.draft")}</SelectItem>
                          <SelectItem value="scheduled">{t("status.scheduled")}</SelectItem>
                          <SelectItem value="published">{t("status.published")}</SelectItem>
                          <SelectItem value="archived">{t("status.archived")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {watchedStatus === "scheduled" ? (
                  <FormField
                    control={form.control}
                    name="scheduledFor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("fields.publishOn")}</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                {watchedStatus === "published" ? (
                  <FormField
                    control={form.control}
                    name="publishedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("fields.publishedAt")}</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} />
                        </FormControl>
                        <FormDescription>{t("descriptions.leaveBlankUseNow")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                <FormField
                  control={form.control}
                  name="visibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.visibility")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="public">{t("visibility.public")}</SelectItem>
                          <SelectItem value="private">{t("visibility.private")}</SelectItem>
                          <SelectItem value="password">{t("visibility.password")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {watchedVisibility === "password" ? (
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("fields.password")}</FormLabel>
                        <FormControl>
                          <Input type="text" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                <FormField
                  control={form.control}
                  name="isFeatured"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-md border p-3">
                      <FormLabel className="m-0">{t("fields.featuredPost")}</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="allowComments"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-md border p-3">
                      <FormLabel className="m-0">{t("fields.allowComments")}</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>{t("sections.organization")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <FormLabel>{t("fields.categories")}</FormLabel>
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                    {categories.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("emptyCategories")}
                      </p>
                    ) : (
                      categories.map((c) => (
                        <label
                          key={c._id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={watchedCategoryIds.includes(c._id)}
                            onCheckedChange={() => toggleCategory(c._id)}
                          />
                          {c.name}
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <FormLabel>{t("fields.tags")}</FormLabel>
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder={t("placeholders.tag")}
                    />
                    <Button type="button" variant="outline" onClick={addTag}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {watchedTags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {watchedTags.map((t) => (
                        <Badge key={t} variant="secondary" className="gap-1">
                          {t}
                          <button
                            type="button"
                            className="ml-1 inline-flex"
                            onClick={() => removeTag(t)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </Form>
  );
}
