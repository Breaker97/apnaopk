"use client";

import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Loader2, Search } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams, useRouter } from "next/navigation";
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
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { CategoryFormSkeleton } from "@/components/admin/category-form-skeleton";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { SearchEngineListingPreview } from "@/components/admin/search-engine-listing-preview";
import { CategoryVariantsEditor } from "@/components/admin/category-variants-editor";
import { useGlobalVariants } from "@/components/admin/variants-manager/use-global-variants";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { AiStudioImageField } from "@/components/ai-authoring/ai-studio-image-field";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import type { ProductOption } from "@/components/admin/variants-manager/helpers";
import type {
  AIAuthoringRequest,
  AIAuthoringSeoDraft,
} from "@/lib/ai-authoring/types";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { MAX_MEGA_MENU_DEPTH } from "@/lib/site-config/menu-depth";

/** The catalog never nests deeper than the storefront panel can draw. */
const MAX_CATEGORY_DEPTH = MAX_MEGA_MENU_DEPTH;

const categorySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z.string().max(500, "Description cannot exceed 500 characters").optional(),
  parentId: z.string().optional(),
  image: z.string().optional(),
  icon: z.string().optional(),
  isActive: z.boolean(),
  featured: z.boolean(),
  displayOrder: z.number().int().min(0),
  seo: z
    .object({
      pageTitle: z
        .string()
        .max(70, "Page title should be under 70 characters")
        .optional(),
      metaDescription: z
        .string()
        .max(320, "Meta description should be under 320 characters")
        .optional(),
      slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

// AI authoring bounds — mirror the category schema so a generated value never
// trips zod validation on save.
const DESCRIPTION_MIN_CHARS = 50;
const DESCRIPTION_MAX_CHARS = 500;

type CategoryFormData = z.infer<typeof categorySchema>;

interface Category {
  _id: string;
  name: string;
  parentId?: string | null;
  path?: string[];
}

/** The part of GET /api/categories/[id]'s document this form reads back. */
interface CategoryRecord {
  name: string;
  description?: string;
  parentId?: string;
  image?: string;
  icon?: string;
  isActive: boolean;
  featured?: boolean;
  order?: number;
  slug?: string;
  seo?: { pageTitle?: string; metaDescription?: string; tags?: string[] };
  productCount?: number;
  options?: Record<string, unknown>[];
}

interface CategoryFormProps {
  categoryId?: string;
}

export function CategoryForm({ categoryId }: CategoryFormProps) {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = typeof params.locale === "string" ? params.locale : "en";
  const basePath = `/${locale}/admin/categories`;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(!!categoryId);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCount, setProductCount] = useState<number | null>(null);

  // Which categories may hold this one. Two things rule an option out: it is
  // inside the branch being moved (that would fold the tree into itself), or
  // it sits so deep that the branch would land past the third level.
  const parentOptions = useMemo(() => {
    const parentOf = new Map<string, string | null>();
    const childrenOf = new Map<string, string[]>();
    for (const category of categories) {
      const parentId = category.parentId ? String(category.parentId) : null;
      parentOf.set(category._id, parentId);
      if (parentId) {
        childrenOf.set(parentId, [
          ...(childrenOf.get(parentId) || []),
          category._id,
        ]);
      }
    }

    const depthOf = (id: string) => {
      let depth = 0;
      let cursor: string | null = id;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        depth += 1;
        cursor = parentOf.get(cursor) ?? null;
      }
      return depth;
    };

    const heightOf = (id: string): number => {
      const children = childrenOf.get(id) || [];
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map(heightOf));
    };

    const insideBranch = new Set<string>();
    if (categoryId) {
      const queue = [categoryId];
      while (queue.length > 0) {
        const id = queue.shift() as string;
        if (insideBranch.has(id)) continue;
        insideBranch.add(id);
        queue.push(...(childrenOf.get(id) || []));
      }
    }

    const movingHeight = categoryId ? heightOf(categoryId) : 1;
    const blocked = new Set<string>();
    const options = categories.filter(
      (category) => !insideBranch.has(category._id),
    );
    for (const category of options) {
      if (depthOf(category._id) + movingHeight > MAX_CATEGORY_DEPTH) {
        blocked.add(category._id);
      }
    }

    return { options, blocked, movingHeight };
  }, [categories, categoryId]);
  // Variant option template lives outside react-hook-form (same pattern the
  // product form uses for its options).
  const [categoryOptions, setCategoryOptions] = useState<ProductOption[]>([]);

  // CategoryVariantsEditor loads the same list, but it only mounts once the
  // record has arrived. Subscribing here as well starts that shared,
  // module-cached request in the first commit, so the option suggestions load
  // in parallel with the record instead of behind it.
  useGlobalVariants();

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: "",
      description: "",
      parentId: "none",
      image: "",
      icon: "",
      isActive: true,
      featured: false,
      displayOrder: 0,
      seo: {
        pageTitle: "",
        metaDescription: "",
        slug: "",
        tags: [],
      },
    },
  });

  useEffect(() => {
    async function fetchCategories() {
      try {
        // The same URL answers with a bare array or the paginated envelope
        // depending on the query, so both shapes are unwrapped here.
        const payload = await apiClient.get<Category[] | { data?: Category[] }>(
          "/api/categories?flat=true",
        );
        const allCats = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
        setCategories(allCats);
      } catch (error) {
        console.error("Failed to fetch categories:", error);
      }
    }

    fetchCategories();
  }, [categoryId]);

  useEffect(() => {
    if (!categoryId) return;

    async function fetchCategory() {
      setIsFetching(true);
      try {
        const category = await apiClient.get<CategoryRecord>(
          `/api/categories/${categoryId}`,
        );
        setProductCount(category.productCount ?? null);
        form.reset({
          name: category.name,
          description: category.description || "",
          parentId: category.parentId || "none",
          image: category.image || "",
          icon: category.icon || "",
          isActive: category.isActive,
          featured: Boolean(category.featured),
          displayOrder: category.order || 0,
          seo: {
            pageTitle: category.seo?.pageTitle || "",
            metaDescription: category.seo?.metaDescription || "",
            slug: category.slug || "",
            tags: Array.isArray(category.seo?.tags) ? category.seo.tags : [],
          },
        });
        // Map stored options (server `_id` shape) to the editor's `id` shape,
        // preserving original ids.
        setCategoryOptions(
          Array.isArray(category.options)
            ? category.options.map(
                (option: Record<string, unknown>, optionIdx: number) => ({
                  id: String(option._id || crypto.randomUUID()),
                  name: String(option.name || ""),
                  position:
                    typeof option.position === "number"
                      ? option.position
                      : optionIdx,
                  values: Array.isArray(option.values)
                    ? option.values.map(
                        (val: Record<string, unknown>, valueIdx: number) => ({
                          id: String(val._id || crypto.randomUUID()),
                          value: String(val.value || ""),
                          colorCode:
                            typeof val.colorCode === "string"
                              ? val.colorCode
                              : undefined,
                          position:
                            typeof val.position === "number"
                              ? val.position
                              : valueIdx,
                        }),
                      )
                    : [],
                }),
              )
            : [],
        );
      } catch (error) {
        console.error("Failed to fetch category:", error);
        toast.error("Failed to load category");
      } finally {
        setIsFetching(false);
      }
    }

    fetchCategory();
  }, [categoryId, form]);

  const onSubmit = async (data: CategoryFormData) => {
    setIsLoading(true);
    try {
      const url = categoryId
        ? `/api/categories/${categoryId}`
        : "/api/categories";
      const method = categoryId ? "PUT" : "POST";

      const payload: Record<string, unknown> = { ...data };
      // "none" is the picker's root-category option. It has to travel as an
      // explicit null: dropping the key leaves the API's `$set` untouched, so an
      // existing parent survives the save and the category never reaches the rail.
      payload.parentId = payload.parentId === "none" ? null : payload.parentId;

      // Serialize the variant template back to the stored `_id` shape, dropping
      // incomplete options (no name or no values).
      payload.options = [...categoryOptions]
        .sort((a, b) => a.position - b.position)
        .filter((option) => option.name.trim() && option.values.length > 0)
        .map((option, idx) => ({
          _id: option.id,
          name: option.name.trim(),
          position: typeof option.position === "number" ? option.position : idx,
          values: [...option.values]
            .sort((a, b) => a.position - b.position)
            .filter((value) => value.value.trim())
            .map((value, vidx) => ({
              _id: value.id,
              value: value.value.trim(),
              colorCode: value.colorCode,
              position:
                typeof value.position === "number" ? value.position : vidx,
            })),
        }));

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        toast.success(
          categoryId
            ? "Category updated successfully"
            : "Category created successfully",
        );
        router.push(basePath);
      } else {
        toast.error(result.message || "Failed to save category");
      }
    } catch {
      toast.error("An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const watchedName =
    useWatch({ control: form.control, name: "name" }) || "";
  const watchedDescription =
    useWatch({ control: form.control, name: "description" }) || "";
  const watchedSeoPageTitle =
    useWatch({ control: form.control, name: "seo.pageTitle" }) || "";
  const watchedSeoMetaDescription =
    useWatch({ control: form.control, name: "seo.metaDescription" }) || "";
  const watchedSeoSlug =
    useWatch({ control: form.control, name: "seo.slug" }) || "";
  const watchedSeoTags =
    useWatch({ control: form.control, name: "seo.tags" }) || [];
  const watchedActive =
    useWatch({ control: form.control, name: "isActive" }) ?? true;
  const watchedFeatured =
    useWatch({ control: form.control, name: "featured" }) ?? false;

  // Category forms are admin-only, so the content endpoint is always the admin
  // one (no vendor variant like the product form has).
  const aiAuthoring = useAiAuthoring({
    contentEndpoint: "/api/admin/ai-authoring/content",
  });

  // Context handed to the model on every generate — read fresh so edits made
  // just before opening the menu are included.
  const getCategoryAuthoringFields = () => {
    const parentId = form.getValues("parentId");
    const parentName =
      parentId && parentId !== "none"
        ? categories.find((category) => category._id === parentId)?.name || ""
        : "";
    return {
      name: watchedName,
      description: watchedDescription,
      parent: parentName,
      tags: watchedSeoTags,
    };
  };

  const ensureNameForAI = () => {
    if (watchedName.trim()) return true;
    toast.error("Add a category name before using AI generation");
    return false;
  };

  const descriptionRequest: AIAuthoringRequest = {
    entity: "category",
    operation: "description",
    locale,
    targetField: "description",
    fields: getCategoryAuthoringFields(),
    constraints: {
      maxLength: DESCRIPTION_MAX_CHARS,
      audience: "shopper",
    },
  };

  const seoRequest: AIAuthoringRequest = {
    entity: "category",
    operation: "seo",
    locale,
    targetField: "seo",
    fields: getCategoryAuthoringFields(),
    constraints: {
      audience: "shopper",
    },
  };

  const generateDescriptionDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent(
      "category-description",
      request,
    );
    if (typeof draft?.fields.description === "string")
      return draft.fields.description;
    if (typeof draft?.fields.content === "string") return draft.fields.content;
    return null;
  };

  const generateSeoDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("category-seo", request);
    return draft?.seo ?? null;
  };

  // Edit-only: `isFetching` seeds from `categoryId`, so the create page never
  // renders this and keeps painting the empty form immediately.
  if (isFetching) {
    return (
      <CategoryFormSkeleton />
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mx-auto w-full max-w-6xl space-y-6"
      >
        <AdminFormStickyHeader
          className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
          title={watchedName || (categoryId ? "Edit Category" : "Add category")}
          status={
            <>
              <Badge
                variant={watchedActive ? "default" : "outline"}
                className="shrink-0"
              >
                {watchedActive ? "Active" : "Inactive"}
              </Badge>
              {watchedFeatured ? (
                <Badge variant="secondary" className="shrink-0">
                  Featured
                </Badge>
              ) : null}
            </>
          }
          actions={
            <>
              <Button type="submit" disabled={isLoading} size="sm">
                {isLoading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : null}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.back()}
                className="shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Electronics" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel>Description</FormLabel>
                        <AiGenerateMenu
                          label="Generate"
                          placeholder="Describe this category in a sentence or two…"
                          minChars={DESCRIPTION_MIN_CHARS}
                          maxChars={DESCRIPTION_MAX_CHARS}
                          request={descriptionRequest}
                          loading={aiAuthoring.isLoading("category-description")}
                          canOpen={ensureNameForAI}
                          onGenerate={generateDescriptionDraft}
                          onApply={(value) =>
                            form.setValue("description", value, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        />
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder="Describe this category..."
                          rows={4}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {field.value?.length || 0}/500 characters
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Media</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="image"
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
                                    alt: form.getValues("name") || undefined,
                                    position: 0,
                                  } as UploadedMedia,
                                ]
                              : []
                          }
                          onChange={(items) => {
                            const image = items.find(
                              (item) => item.type === "image",
                            );
                            field.onChange(image?.url || "");
                          }}
                          aiGenerateAction={
                            <AiStudioImageField
                              entity="category"
                              scope="admin"
                              locale={locale}
                              targetField="image"
                              audience="shopper"
                              getFields={getCategoryAuthoringFields}
                              value={field.value || ""}
                              alt={watchedName || undefined}
                              onChange={(url) => field.onChange(url)}
                              breadcrumbRoot={
                                categoryId ? "Edit category" : "Add category"
                              }
                              breadcrumbLeaf="Image"
                              savedMessage="Saved to category image"
                              subjectNoun="category"
                              posHref={`/${locale}/admin/pos`}
                              browseHref={`/${locale}`}
                              persistKey={`category:admin:${categoryId ?? "new"}:image`}
                            />
                          }
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
                <CardTitle>Icon</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="icon"
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
                                    _id: "existing-icon",
                                    url: field.value,
                                    type: "image",
                                    mimeType: "image/*",
                                    alt: form.getValues("name") || undefined,
                                    position: 0,
                                  } as UploadedMedia,
                                ]
                              : []
                          }
                          onChange={(items) => {
                            const icon = items.find(
                              (item) => item.type === "image",
                            );
                            field.onChange(icon?.url || "");
                          }}
                          aiGenerateAction={
                            <AiStudioImageField
                              entity="category"
                              scope="admin"
                              locale={locale}
                              targetField="icon"
                              audience="shopper"
                              getFields={getCategoryAuthoringFields}
                              value={field.value || ""}
                              alt={watchedName || undefined}
                              onChange={(url) => field.onChange(url)}
                              breadcrumbRoot={
                                categoryId ? "Edit category" : "Add category"
                              }
                              breadcrumbLeaf="Icon"
                              savedMessage="Saved to category icon"
                              subjectNoun="category"
                              posHref={`/${locale}/admin/pos`}
                              browseHref={`/${locale}`}
                              // The field asks for a transparent square icon, so
                              // generation starts there instead of making the
                              // merchant remove an opaque background by hand.
                              generateDefaults={{
                                background: "transparent",
                                size: "1024x1024",
                              }}
                              persistKey={`category:admin:${categoryId ?? "new"}:icon`}
                            />
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Small icon shown in the header, megamenu, and category
                        navigation. Use a transparent square image for best
                        results.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Variants</CardTitle>
              </CardHeader>
              <CardContent>
                <CategoryVariantsEditor
                  options={categoryOptions}
                  onChange={setCategoryOptions}
                />
              </CardContent>
            </Card>

            <SearchEngineListingPreview
              pageTitle={watchedSeoPageTitle}
              metaDescription={watchedSeoMetaDescription}
              handle={watchedSeoSlug}
              tags={watchedSeoTags}
              title={watchedName}
              description={watchedDescription}
              entityLabel="category"
              emptyTitle="Untitled Category"
              emptyHandle="category-handle"
              pathPrefix="categories"
              titlePlaceholder={watchedName || "Category name"}
              handlePlaceholder="electronics"
              defaultEditing
              aiGenerateAction={
                <AiGenerateMenu<AIAuthoringSeoDraft>
                  label="Improve SEO"
                  placeholder="Describe the SEO you want — keywords to target, tone, focus…"
                  allowAttachment={false}
                  request={seoRequest}
                  loading={aiAuthoring.isLoading("category-seo")}
                  canOpen={ensureNameForAI}
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
                      form.setValue(
                        "seo.metaDescription",
                        draft.metaDescription,
                        { shouldDirty: true, shouldValidate: true },
                      );
                    }
                    const slug = draft.slug || draft.handle;
                    if (slug) {
                      form.setValue("seo.slug", slug, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                    if (draft.tags?.length) {
                      form.setValue("seo.tags", draft.tags, {
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
              onHandleChange={(value) =>
                form.setValue("seo.slug", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onTagsChange={(value) =>
                form.setValue("seo.tags", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          </div>

          <div className="space-y-4">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        value={field.value ? "active" : "inactive"}
                        onValueChange={(value) =>
                          field.onChange(value === "active")
                        }
                      >
                        <FormControl>
                          <SelectTrigger className="w-full text-start">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position="popper" sideOffset={4}>
                          <SelectItem
                            value="active"
                            description="Visible in category navigation and filters"
                          >
                            Active
                          </SelectItem>
                          <SelectItem
                            value="inactive"
                            description="Hidden from the storefront"
                          >
                            Inactive
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="featured"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Featured category</FormLabel>
                        <FormDescription>
                          Show this category in the storefront featured
                          categories section.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Organization</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent category</FormLabel>
                      <FormControl>
                        <ParentCategoryPicker
                          categories={parentOptions.options}
                          blocked={parentOptions.blocked}
                          value={field.value || "none"}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        Select a parent to create a sub-category.
                      </FormDescription>
                      <MegaMenuNestingHint
                        parent={
                          field.value && field.value !== "none"
                            ? categories.find(
                                (category) => category._id === field.value,
                              ) || null
                            : null
                        }
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="displayOrder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display order</FormLabel>
                      <FormControl>
                        <NumberInput
                          min={0}
                          step={1}
                          {...field}
                          whenEmpty={0}
                          normalize={Math.trunc}
                          onValueChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>Lower numbers appear first.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {categoryId && productCount !== null ? (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Products</p>
                      <p className="text-xs text-muted-foreground">
                        Products assigned to this category.
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {productCount}
                    </span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </Form>
  );
}

function ParentCategoryPicker({
  categories,
  blocked,
  value,
  onChange,
}: {
  categories: Category[];
  /** Options that would push this branch past the third level. */
  blocked: Set<string>;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = categories.find((category) => category._id === value);
  const selectedLabel = selected
    ? getCategoryLabel(selected)
    : "None (root category)";

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCategories = normalizedQuery
    ? categories.filter((category) =>
        getCategorySearchText(category).includes(normalizedQuery),
      )
    : categories;

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full min-w-0 justify-between overflow-hidden font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="min-w-0 truncate text-left">{selectedLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search categories..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          <ParentCategoryOption
            selected={value === "none"}
            label="None (root category)"
            onSelect={() => handleSelect("none")}
          />

          {filteredCategories.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No categories found.
            </div>
          ) : (
            filteredCategories.map((category) => (
              <ParentCategoryOption
                key={category._id}
                selected={category._id === value}
                label={getCategoryLabel(category)}
                disabled={blocked.has(category._id)}
                onSelect={() => handleSelect(category._id)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ParentCategoryOption({
  selected,
  label,
  disabled,
  onSelect,
}: {
  selected: boolean;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={
        disabled
          ? `Already at level ${MAX_CATEGORY_DEPTH} — nothing can nest under it.`
          : undefined
      }
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
        disabled ? "cursor-not-allowed opacity-45" : "hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {disabled ? (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
          {`level ${MAX_CATEGORY_DEPTH}`}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The mega menu inherits whatever the catalog was nested as, so the rule is
 * stated here — at the moment a parent is picked — rather than being
 * discovered later in the menu builder.
 */
function MegaMenuNestingHint({ parent }: { parent: Category | null }) {
  // `path` is the ancestor names ending in self, so its length is the
  // parent's own level and this category sits one below it.
  const level = parent ? (parent.path?.length || 1) + 1 : 1;
  const rungs = [
    { level: 1, from: "Main category", to: "Rail row" },
    { level: 2, from: "Sub-category", to: "Column" },
    { level: 3, from: "Sub-sub-category", to: "Link" },
    { level: 4, from: "Level 4", to: "not allowed" },
  ];

  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-semibold">How this nests in the mega menu</p>
      <div className="space-y-1">
        {rungs.map((rung) => {
          const isCurrent =
            rung.level === Math.min(level, 4) ||
            (rung.level === 4 && level > 4);
          return (
            <div
              key={rung.level}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                isCurrent ? "bg-primary/10" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "rounded px-1 py-px text-[9px] font-bold tracking-wide",
                  rung.level === 4
                    ? "bg-amber-100 text-amber-800"
                    : "bg-primary/10 text-primary",
                )}
              >
                L{rung.level}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {rung.from} &rarr;{" "}
                <span className={isCurrent ? "font-semibold" : undefined}>
                  {rung.to}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {level > 3
          ? "This category sits deeper than the storefront draws, so the mega menu skips it. Move it up a level to have it appear."
          : level === 3
            ? `Deepest level — nothing can nest under it. In the mega menu it is a Link under ${parent?.name || "its parent"}.`
            : parent
              ? `In the mega menu this becomes a Column under ${parent.name}.`
              : "With no parent this becomes a row in the mega menu's left rail."}
      </p>
    </div>
  );
}

function getCategoryLabel(category: Category) {
  return category.path?.length ? category.path.join(" / ") : category.name;
}

function getCategorySearchText(category: Category) {
  return [category.name, ...(category.path || [])].join(" ").toLowerCase();
}
