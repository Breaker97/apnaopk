"use client";

import { z } from "zod";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { BrandFormSkeleton } from "@/components/admin/brand-form-skeleton";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { SearchEngineListingPreview } from "@/components/admin/search-engine-listing-preview";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { AiStudioImageField } from "@/components/ai-authoring/ai-studio-image-field";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import { ApiClientError, apiClient } from "@/lib/api/client";
import type {
  AIAuthoringRequest,
  AIAuthoringSeoDraft,
} from "@/lib/ai-authoring/types";

const brandSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z
    .string()
    .max(500, "Description cannot exceed 500 characters")
    .optional(),
  logo: z.string().optional(),
  website: z.string().optional(),
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
    })
    .optional(),
});

// AI authoring bounds — mirror the brand schema above so a generated value never
// trips zod validation on save. The lower bound is a quality floor.
const DESCRIPTION_MIN_CHARS = 50;
const DESCRIPTION_MAX_CHARS = 500;

type BrandFormData = z.infer<typeof brandSchema>;

/** The subset of the brand document this form reads back on edit. */
interface BrandRecord {
  name: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive: boolean;
  featured?: boolean;
  order?: number;
  slug?: string;
  seo?: { pageTitle?: string; metaDescription?: string };
  productCount?: number;
}

interface BrandFormProps {
  brandId?: string;
  /** API collection path for create/fetch/update. Defaults to the admin API. */
  apiBase?: string;
  /** Admin area segment used to build the list/redirect path. Defaults to "admin". */
  area?: "admin" | "vendor";
}

export function BrandForm({
  brandId,
  apiBase = "/api/brands",
  area = "admin",
}: BrandFormProps) {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = typeof params.locale === "string" ? params.locale : "en";
  const basePath = `/${locale}/${area}/brands`;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(!!brandId);
  const [productCount, setProductCount] = useState<number | null>(null);

  const form = useForm<BrandFormData>({
    resolver: zodResolver(brandSchema),
    defaultValues: {
      name: "",
      description: "",
      logo: "",
      website: "",
      isActive: true,
      featured: false,
      displayOrder: 0,
      seo: {
        pageTitle: "",
        metaDescription: "",
        slug: "",
      },
    },
  });

  useEffect(() => {
    if (!brandId) return;

    async function fetchBrand() {
      setIsFetching(true);
      try {
        const brand = await apiClient.get<BrandRecord>(`${apiBase}/${brandId}`);
        setProductCount(brand.productCount ?? null);
        form.reset({
          name: brand.name,
          description: brand.description || "",
          logo: brand.logo || "",
          website: brand.website || "",
          isActive: brand.isActive,
          featured: Boolean(brand.featured),
          displayOrder: brand.order || 0,
          seo: {
            pageTitle: brand.seo?.pageTitle || "",
            metaDescription: brand.seo?.metaDescription || "",
            slug: brand.slug || "",
          },
        });
      } catch (error) {
        console.error("Failed to fetch brand:", error);
        toast.error("Failed to load brand");
      } finally {
        setIsFetching(false);
      }
    }

    fetchBrand();
  }, [brandId, form, apiBase]);

  const onSubmit = async (data: BrandFormData) => {
    setIsLoading(true);
    try {
      const url = brandId ? `${apiBase}/${brandId}` : apiBase;

      if (brandId) {
        await apiClient.put(url, data);
      } else {
        await apiClient.post(url, data);
      }

      toast.success(
        brandId ? "Brand updated successfully" : "Brand created successfully",
      );
      router.push(basePath);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "An error occurred",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const watchedName = useWatch({ control: form.control, name: "name" }) || "";
  const watchedDescription =
    useWatch({ control: form.control, name: "description" }) || "";
  const watchedWebsite =
    useWatch({ control: form.control, name: "website" }) || "";
  const watchedSeoPageTitle =
    useWatch({ control: form.control, name: "seo.pageTitle" }) || "";
  const watchedSeoMetaDescription =
    useWatch({ control: form.control, name: "seo.metaDescription" }) || "";
  const watchedSeoSlug =
    useWatch({ control: form.control, name: "seo.slug" }) || "";
  const watchedActive =
    useWatch({ control: form.control, name: "isActive" }) ?? true;
  const watchedFeatured =
    useWatch({ control: form.control, name: "featured" }) ?? false;

  // Unlike the category/collection forms, this one is mounted in the vendor area
  // too, so the endpoint follows `area` — the vendor route gates brand authoring
  // behind EDIT_BRANDS, which the admin route does not.
  const aiAuthoring = useAiAuthoring({
    contentEndpoint:
      area === "vendor"
        ? "/api/vendor/ai-authoring/content"
        : "/api/admin/ai-authoring/content",
  });

  // Context handed to the model on every generate — read fresh so edits made
  // just before opening the menu are included.
  const getBrandAuthoringFields = () => ({
    name: watchedName,
    description: watchedDescription,
    website: watchedWebsite,
  });

  const ensureNameForAI = () => {
    if (watchedName.trim()) return true;
    toast.error("Add a brand name before using AI generation");
    return false;
  };

  const descriptionRequest: AIAuthoringRequest = {
    entity: "brand",
    operation: "description",
    locale,
    targetField: "description",
    fields: getBrandAuthoringFields(),
    constraints: {
      maxLength: DESCRIPTION_MAX_CHARS,
      audience: "shopper",
    },
  };

  const seoRequest: AIAuthoringRequest = {
    entity: "brand",
    operation: "seo",
    locale,
    targetField: "seo",
    fields: getBrandAuthoringFields(),
    constraints: {
      audience: "shopper",
    },
  };

  const generateDescriptionDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("brand-description", request);
    if (typeof draft?.fields.description === "string")
      return draft.fields.description;
    if (typeof draft?.fields.content === "string") return draft.fields.content;
    return null;
  };

  const generateSeoDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("brand-seo", request);
    return draft?.seo ?? null;
  };

  // Edit-only: `isFetching` seeds from `brandId`, so the create page never
  // renders this and keeps painting the empty form immediately.
  if (isFetching) {
    return (
      <BrandFormSkeleton area={area} />
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
          title={watchedName || (brandId ? "Edit Brand" : "Add brand")}
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
                        <Input placeholder="Apple" {...field} />
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
                          placeholder="Describe this brand in a sentence or two…"
                          minChars={DESCRIPTION_MIN_CHARS}
                          maxChars={DESCRIPTION_MAX_CHARS}
                          request={descriptionRequest}
                          loading={aiAuthoring.isLoading("brand-description")}
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
                          placeholder="Describe this brand..."
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

                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl>
                        <Input placeholder="https://brand.com" {...field} />
                      </FormControl>
                      <FormDescription>
                        Optional link to the brand&apos;s official website.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Logo</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="logo"
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
                                    _id: "existing-logo",
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
                            const logo = items.find(
                              (item) => item.type === "image",
                            );
                            field.onChange(logo?.url || "");
                          }}
                          aiGenerateAction={
                            <AiStudioImageField
                              entity="brand"
                              // `area` is already "admin" | "vendor", which is
                              // exactly the scope the studio's endpoints take.
                              scope={area}
                              locale={locale}
                              targetField="logo"
                              audience="shopper"
                              getFields={getBrandAuthoringFields}
                              value={field.value || ""}
                              alt={watchedName || undefined}
                              onChange={(url) => field.onChange(url)}
                              breadcrumbRoot={
                                brandId ? "Edit brand" : "Add brand"
                              }
                              breadcrumbLeaf="Logo"
                              savedMessage="Saved to brand logo"
                              subjectNoun="brand"
                              // The field asks for a transparent square logo, so
                              // generation starts there instead of making the
                              // merchant remove an opaque background by hand.
                              generateDefaults={{
                                background: "transparent",
                                size: "1024x1024",
                              }}
                              posHref={`/${locale}/${area}/pos`}
                              browseHref={`/${locale}`}
                              persistKey={`brand:${area}:${brandId ?? "new"}:logo`}
                            />
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Brand logo shown on the storefront brands page and on
                        product pages. Use a transparent square image for best
                        results.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <SearchEngineListingPreview
              pageTitle={watchedSeoPageTitle}
              metaDescription={watchedSeoMetaDescription}
              handle={watchedSeoSlug}
              title={watchedName}
              description={watchedDescription}
              entityLabel="brand"
              emptyTitle="Untitled Brand"
              emptyHandle="brand-handle"
              pathPrefix="brands"
              titlePlaceholder={watchedName || "Brand name"}
              handlePlaceholder="apple"
              defaultEditing
              aiGenerateAction={
                <AiGenerateMenu<AIAuthoringSeoDraft>
                  label="Improve SEO"
                  placeholder="Describe the SEO you want — keywords to target, tone, focus…"
                  allowAttachment={false}
                  request={seoRequest}
                  loading={aiAuthoring.isLoading("brand-seo")}
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
                    // The model names this either way; the form field is `slug`.
                    const slug = draft.slug || draft.handle;
                    if (slug) {
                      form.setValue("seo.slug", slug, {
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
            />
          </div>

          <div className="space-y-4">
            {area === "vendor" ? (
              <Card className="gap-2">
                <CardHeader>
                  <CardTitle>Review status</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {brandId
                      ? "Edits to a brand's name or logo are re-submitted for admin review before going live. Visibility and featured placement are managed by the store admin."
                      : "New brands are submitted for admin review. Once approved they become visible on the storefront and available to assign to products."}
                  </p>
                </CardContent>
              </Card>
            ) : (
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
                            description="Visible in brand navigation and filters"
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
                        <FormLabel>Featured brand</FormLabel>
                        <FormDescription>
                          Highlight this brand in the storefront featured brands
                          section.
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
            )}

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Organization</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                      <FormDescription>
                        Lower numbers appear first.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {brandId && productCount !== null ? (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Products</p>
                      <p className="text-xs text-muted-foreground">
                        Products assigned to this brand.
                      </p>
                    </div>
                    <span className="text-sm font-semibold">{productCount}</span>
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
