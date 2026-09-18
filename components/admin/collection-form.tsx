"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { MediaUploader, UploadedMedia } from "@/components/ui/media-uploader";
import {
  Card,
  CardContent,
  CardDescription,
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
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import { CollectionConditionBuilder } from "./collection-condition-builder";
import { CollectionProductSelector } from "./collection-product-selector";
import { CollectionFormSkeleton } from "@/components/admin/collection-form-skeleton";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { SearchEngineListingPreview } from "@/components/admin/search-engine-listing-preview";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { AiStudioImageField } from "@/components/ai-authoring/ai-studio-image-field";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import type {
  AIAuthoringRequest,
  AIAuthoringSeoDraft,
} from "@/lib/ai-authoring/types";
import type { CollectionCondition } from "@/types";
import type { ProductPickerItem } from "@/types/product-list";

const collectionSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(5000).optional(),
  collectionType: z.enum(["manual", "automated"]),
  kind: z.enum(["collection", "look"]),
  status: z.enum(["active", "draft"]),
  sortOrder: z.enum([
    "manual",
    "best-selling",
    "title-asc",
    "title-desc",
    "price-asc",
    "price-desc",
    "created-asc",
    "created-desc",
  ]),
  position: z.number().int().min(0),
  publishOnlineStore: z.boolean(),
  publishPointOfSale: z.boolean(),
  seoPageTitle: z.string().max(70).optional(),
  seoMetaDescription: z.string().max(320).optional(),
  seoHandle: z.string().optional(),
  imageUrl: z.string().optional(),
  imageAlt: z.string().optional(),
});

// AI authoring bounds — mirror the collection schema above so a generated value
// never trips zod validation on save. The lower bound is a quality floor.
const DESCRIPTION_MIN_CHARS = 50;
const DESCRIPTION_MAX_CHARS = 5000;

type CollectionFormData = z.infer<typeof collectionSchema>;

interface CollectionFormProps {
  collectionId?: string;
}

export function CollectionForm({ collectionId }: CollectionFormProps) {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = typeof params.locale === "string" ? params.locale : "en";
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(!!collectionId);

  // Manual collection products — the id array drives ordering and the save
  // payload; the populated rows beside it only seed the picker's display.
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [initialProducts, setInitialProducts] = useState<ProductPickerItem[]>(
    [],
  );

  // Automated collection conditions
  const [conditions, setConditions] = useState<CollectionCondition[]>([]);
  const [conditionMatch, setConditionMatch] = useState<"all" | "any">("all");

  const form = useForm<CollectionFormData>({
    resolver: zodResolver(collectionSchema),
    defaultValues: {
      title: "",
      description: "",
      collectionType: "manual",
      kind: "collection",
      status: "draft",
      sortOrder: "manual",
      position: 0,
      publishOnlineStore: true,
      publishPointOfSale: false,
      seoPageTitle: "",
      seoMetaDescription: "",
      seoHandle: "",
      imageUrl: "",
      imageAlt: "",
    },
  });

  const collectionType =
    useWatch({
      control: form.control,
      name: "collectionType",
    }) || "manual";
  const watchedTitle = useWatch({ control: form.control, name: "title" }) || "";
  const watchedDescription =
    useWatch({ control: form.control, name: "description" }) || "";
  const watchedSeoPageTitle =
    useWatch({ control: form.control, name: "seoPageTitle" }) || "";
  const watchedSeoMetaDescription =
    useWatch({ control: form.control, name: "seoMetaDescription" }) || "";
  const watchedSeoHandle =
    useWatch({ control: form.control, name: "seoHandle" }) || "";
  const watchedImageAlt =
    useWatch({ control: form.control, name: "imageAlt" }) || "";

  // Fetch collection data if editing
  useEffect(() => {
    if (!collectionId) return;

    async function fetchCollection() {
      setIsFetching(true);
      try {
        const res = await fetch(`/api/admin/collections/${collectionId}`);
        const data = await res.json();

        if (data.success && data.data) {
          const collection = data.data;
          form.reset({
            title: collection.title,
            description: collection.description || "",
            collectionType: collection.collectionType,
            kind: collection.kind === "look" ? "look" : "collection",
            status: collection.status,
            sortOrder: collection.sortOrder,
            position: collection.position || 0,
            publishOnlineStore: collection.publishing?.onlineStore ?? true,
            publishPointOfSale: collection.publishing?.pointOfSale ?? false,
            seoPageTitle: collection.seo?.pageTitle || "",
            seoMetaDescription: collection.seo?.metaDescription || "",
            seoHandle: collection.seo?.handle || "",
            imageUrl: collection.image?.url || "",
            imageAlt: collection.image?.alt || "",
          });

          // Set products for manual collection. The response populates each
          // product with exactly the fields the picker renders, so hand those
          // through instead of discarding them and making it look each one up.
          if (collection.products && Array.isArray(collection.products)) {
            const products = collection.products as (ProductPickerItem | string)[];
            setSelectedProducts(
              products.map((p) => (typeof p === "string" ? p : p._id)),
            );
            setInitialProducts(
              products.filter(
                (p): p is ProductPickerItem => typeof p !== "string",
              ),
            );
          }

          // Set conditions for automated collection
          if (collection.conditions && Array.isArray(collection.conditions)) {
            setConditions(collection.conditions);
          }
          setConditionMatch(collection.conditionMatch || "all");
        }
      } catch (error) {
        console.error("Failed to fetch collection:", error);
        toast.error("Failed to load collection");
      } finally {
        setIsFetching(false);
      }
    }

    fetchCollection();
  }, [collectionId, form]);

  const onSubmit = async (data: CollectionFormData) => {
    setIsLoading(true);
    try {
      const url = collectionId
        ? `/api/admin/collections/${collectionId}`
        : "/api/admin/collections";
      const method = collectionId ? "PUT" : "POST";

      const payload = {
        title: data.title,
        description: data.description,
        collectionType: data.collectionType,
        kind: data.kind,
        status: data.status,
        sortOrder: data.sortOrder,
        position: data.position,
        publishing: {
          onlineStore: data.publishOnlineStore,
          pointOfSale: data.publishPointOfSale,
        },
        seo: {
          pageTitle: data.seoPageTitle || undefined,
          metaDescription: data.seoMetaDescription || undefined,
          handle: data.seoHandle || undefined,
        },
        image: data.imageUrl
          ? {
              url: data.imageUrl,
              alt: data.imageAlt || data.title,
            }
          : undefined,
        // Include products or conditions based on type
        products: data.collectionType === "manual" ? selectedProducts : [],
        conditions: data.collectionType === "automated" ? conditions : [],
        conditionMatch:
          data.collectionType === "automated" ? conditionMatch : "all",
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        toast.success(
          collectionId
            ? "Collection updated successfully"
            : "Collection created successfully",
        );
        router.back();
      } else {
        toast.error(result.message || "Failed to save collection");
      }
    } catch {
      toast.error("An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  // Collections are admin-only, so the content endpoint is always the admin one
  // (no vendor variant like the product form has).
  const aiAuthoring = useAiAuthoring({
    contentEndpoint: "/api/admin/ai-authoring/content",
  });

  // Context handed to the model on every generate — read fresh so edits made
  // just before opening the menu are included.
  const getCollectionAuthoringFields = () => ({
    title: watchedTitle,
    description: watchedDescription,
  });

  const ensureTitleForAI = () => {
    if (watchedTitle.trim()) return true;
    toast.error("Add a collection title before using AI generation");
    return false;
  };

  const descriptionRequest: AIAuthoringRequest = {
    entity: "collection",
    operation: "description",
    locale,
    targetField: "description",
    fields: getCollectionAuthoringFields(),
    constraints: {
      maxLength: DESCRIPTION_MAX_CHARS,
      audience: "shopper",
    },
  };

  const seoRequest: AIAuthoringRequest = {
    entity: "collection",
    operation: "seo",
    locale,
    targetField: "seo",
    fields: getCollectionAuthoringFields(),
    constraints: {
      audience: "shopper",
    },
  };

  const generateDescriptionDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent(
      "collection-description",
      request,
    );
    if (typeof draft?.fields.description === "string")
      return draft.fields.description;
    if (typeof draft?.fields.content === "string") return draft.fields.content;
    return null;
  };

  const generateSeoDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("collection-seo", request);
    return draft?.seo ?? null;
  };

  // Edit only — `isFetching` starts false when there is no collection to load,
  // so creating a collection still paints the real form immediately.
  if (isFetching) {
    return (
      <CollectionFormSkeleton />
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
          title={collectionId ? "Edit Collection" : "New Collection"}
          description={
            collectionId
              ? "Update collection details and visibility"
              : "Create a new collection for your catalog"
          }
          actions={
            <>
              <Button type="submit" disabled={isLoading} size="sm">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {collectionId ? "Update Collection" : "Create Collection"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Collection Details</CardTitle>
                <CardDescription>
                  Basic information about the collection
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Summer Collection"
                          {...field}
                        />
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
                          placeholder="Describe this collection in a sentence or two…"
                          minChars={DESCRIPTION_MIN_CHARS}
                          maxChars={DESCRIPTION_MAX_CHARS}
                          request={descriptionRequest}
                          loading={aiAuthoring.isLoading(
                            "collection-description",
                          )}
                          canOpen={ensureTitleForAI}
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
                          placeholder="Describe this collection..."
                          rows={4}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Image */}
                <FormField
                  control={form.control}
                  name="imageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Collection Image</FormLabel>
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
                                  alt: form.getValues("imageAlt") || undefined,
                                  position: 0,
                                } as UploadedMedia,
                              ]
                            : []
                        }
                        onChange={(items) => {
                          const img = items.find((m) => m.type === "image");
                          form.setValue("imageUrl", img?.url || "");
                          if (img?.alt !== undefined) {
                            form.setValue("imageAlt", img.alt);
                          }
                        }}
                        aiGenerateAction={
                          <AiStudioImageField
                            entity="collection"
                            scope="admin"
                            locale={locale}
                            targetField="image"
                            audience="shopper"
                            getFields={getCollectionAuthoringFields}
                            value={field.value || ""}
                            alt={watchedImageAlt || watchedTitle || undefined}
                            onChange={(url, alt) => {
                              field.onChange(url);
                              // The stored alt describes the image it came with,
                              // so it must never outlive it. Clearing it lets
                              // onSubmit fall back to the collection title.
                              form.setValue("imageAlt", url ? (alt ?? "") : "", {
                                shouldDirty: true,
                              });
                            }}
                            breadcrumbRoot={
                              collectionId ? "Edit collection" : "New collection"
                            }
                            breadcrumbLeaf="Image"
                            savedMessage="Saved to collection image"
                            subjectNoun="collection"
                            posHref={`/${locale}/admin/pos`}
                            browseHref={`/${locale}`}
                            persistKey={`collection:admin:${collectionId ?? "new"}:image`}
                          />
                        }
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Collection Type */}
            <Card>
              <CardHeader>
                <CardTitle>Kind</CardTitle>
                <CardDescription>
                  A Look is a styled outfit — its image and the pieces in it.
                  The storefront&apos;s Get the Look and Looks sections draw
                  from Looks; everything else works like any collection.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="grid grid-cols-2 gap-4">
                          {(
                            [
                              {
                                value: "collection",
                                title: "Collection",
                                hint: "A shelf of products",
                              },
                              {
                                value: "look",
                                title: "Look",
                                hint: "An outfit: image + pieces",
                              },
                            ] as const
                          ).map((option) => (
                            <div
                              key={option.value}
                              className={`rounded-md border-2 p-4 hover:bg-accent ${
                                field.value === option.value
                                  ? "border-primary"
                                  : "border-muted"
                              }`}
                            >
                              <input
                                type="radio"
                                id={`kind-${option.value}`}
                                value={option.value}
                                name="kind"
                                checked={field.value === option.value}
                                onChange={() => field.onChange(option.value)}
                                className="sr-only"
                              />
                              <Label
                                htmlFor={`kind-${option.value}`}
                                className="flex flex-col items-center justify-center cursor-pointer gap-1 w-full"
                              >
                                <span className="text-lg font-semibold">
                                  {option.title}
                                </span>
                                <span className="text-sm text-muted-foreground text-center">
                                  {option.hint}
                                </span>
                              </Label>
                            </div>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Collection Type</CardTitle>
                <CardDescription>
                  Choose how products are added to this collection
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="collectionType"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="grid grid-cols-2 gap-4">
                          <div
                            className={`rounded-md border-2 p-4 hover:bg-accent ${
                              field.value === "manual"
                                ? "border-primary"
                                : "border-muted"
                            }`}
                          >
                            <input
                              type="radio"
                              id="manual"
                              value="manual"
                              name="collectionType"
                              checked={field.value === "manual"}
                              onChange={() => field.onChange("manual")}
                              className="sr-only"
                            />
                            <Label
                              htmlFor="manual"
                              className="flex flex-col items-center justify-center cursor-pointer gap-1 w-full"
                            >
                              <span className="text-lg font-semibold">
                                Manual
                              </span>
                              <span className="text-sm text-muted-foreground text-center">
                                Add products one by one
                              </span>
                            </Label>
                          </div>
                          <div
                            className={`rounded-md border-2 p-4 hover:bg-accent ${
                              field.value === "automated"
                                ? "border-primary"
                                : "border-muted"
                            }`}
                          >
                            <input
                              type="radio"
                              id="automated"
                              value="automated"
                              name="collectionType"
                              checked={field.value === "automated"}
                              onChange={() => field.onChange("automated")}
                              className="sr-only"
                            />
                            <Label
                              htmlFor="automated"
                              className="flex flex-col items-center justify-center cursor-pointer gap-1 w-full"
                            >
                              <span className="text-lg font-semibold">
                                Automated
                              </span>
                              <span className="text-sm text-muted-foreground text-center">
                                Products added by conditions
                              </span>
                            </Label>
                          </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Products or Conditions based on type */}
            {collectionType === "manual" ? (
              <CollectionProductSelector
                selectedProducts={selectedProducts}
                onChange={setSelectedProducts}
                initialProducts={initialProducts}
              />
            ) : (
              <CollectionConditionBuilder
                conditions={conditions}
                onChange={setConditions}
                matchType={conditionMatch}
                onMatchTypeChange={setConditionMatch}
              />
            )}

            <SearchEngineListingPreview
              pageTitle={watchedSeoPageTitle}
              metaDescription={watchedSeoMetaDescription}
              handle={watchedSeoHandle}
              title={watchedTitle}
              description={watchedDescription}
              entityLabel="collection"
              emptyTitle="Untitled Collection"
              emptyHandle="collection-handle"
              pathPrefix="collections"
              titlePlaceholder={watchedTitle || "Collection page title"}
              handlePlaceholder="summer-collection"
              defaultEditing
              aiGenerateAction={
                <AiGenerateMenu<AIAuthoringSeoDraft>
                  label="Improve SEO"
                  placeholder="Describe the SEO you want — keywords to target, tone, focus…"
                  allowAttachment={false}
                  request={seoRequest}
                  loading={aiAuthoring.isLoading("collection-seo")}
                  canOpen={ensureTitleForAI}
                  onGenerate={generateSeoDraft}
                  previewText={(draft) =>
                    [draft.pageTitle, draft.metaDescription]
                      .filter(Boolean)
                      .join("\n")
                  }
                  onApply={(draft) => {
                    if (draft.pageTitle) {
                      form.setValue("seoPageTitle", draft.pageTitle, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                    if (draft.metaDescription) {
                      form.setValue("seoMetaDescription", draft.metaDescription, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                    // The model names this either way; the form field is `handle`.
                    const handle = draft.handle || draft.slug;
                    if (handle) {
                      form.setValue("seoHandle", handle, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                  }}
                />
              }
              onPageTitleChange={(value) =>
                form.setValue("seoPageTitle", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onMetaDescriptionChange={(value) =>
                form.setValue("seoMetaDescription", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onHandleChange={(value) =>
                form.setValue("seoHandle", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          </div>

          {/* Right Column - Settings */}
          <div className="space-y-6">
            {/* Status */}
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <NativeSelect
                          value={field.value}
                          onChange={field.onChange}
                        >
                          <option value="draft">Draft</option>
                          <option value="active">Active</option>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Publishing */}
            <Card>
              <CardHeader>
                <CardTitle>Publishing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="publishOnlineStore"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Online Store</FormLabel>
                      </div>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="publishPointOfSale"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Point of Sale</FormLabel>
                      </div>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Sort Order */}
            <Card>
              <CardHeader>
                <CardTitle>Sort Order</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="sortOrder"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <NativeSelect
                          value={field.value}
                          onChange={field.onChange}
                        >
                          <option value="manual">Manual</option>
                          <option value="best-selling">Best Selling</option>
                          <option value="title-asc">Alphabetically, A-Z</option>
                          <option value="title-desc">
                            Alphabetically, Z-A
                          </option>
                          <option value="price-asc">Price, Low to High</option>
                          <option value="price-desc">Price, High to Low</option>
                          <option value="created-desc">Date, New to Old</option>
                          <option value="created-asc">Date, Old to New</option>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Position */}
            <Card>
              <CardHeader>
                <CardTitle>Display Position</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="position"
                  render={({ field }) => (
                    <FormItem>
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
                        Lower numbers appear first
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </Form>
  );
}
