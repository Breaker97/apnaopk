"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  useFieldArray,
  useWatch,
  type UseFormReturn,
} from "react-hook-form";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { RichTextEditor } from "@/components/ui/rich-text-editor-lazy";
import type { ProductFormData } from "@/components/admin/product-form/schema";
import { apiClient } from "@/lib/api/client";
import {
  remainingAttributeSuggestions,
  valuesForAttribute,
  type AttributeSuggestion,
} from "@/lib/products/attribute-suggestions";
import {
  generateSearchHandle,
  sanitizeSearchHandle,
} from "@/components/admin/search-engine-listing-preview";

/**
 * One request per endpoint for the life of the page: the tab is opened and
 * closed while a product is edited, and the catalogue's labels do not change
 * underneath it.
 */
const suggestionRequests = new Map<string, Promise<AttributeSuggestion[]>>();

function loadAttributeSuggestions(endpoint: string): Promise<AttributeSuggestion[]> {
  const cached = suggestionRequests.get(endpoint);
  if (cached) return cached;
  const request = apiClient
    .get<{ suggestions?: AttributeSuggestion[] }>(endpoint)
    .then((payload) =>
      Array.isArray(payload?.suggestions) ? payload.suggestions : [],
    )
    .catch(() => {
      // A failure only costs the suggestions; let the next open try again.
      suggestionRequests.delete(endpoint);
      return [] as AttributeSuggestion[];
    });
  suggestionRequests.set(endpoint, request);
  return request;
}

interface DetailsCardProps {
  form: UseFormReturn<ProductFormData>;
  /**
   * Where the specification autocomplete reads labels already in use — the
   * whole catalogue for staff, the vendor's own products for a vendor.
   */
  attributeSuggestionsEndpoint?: string;
  summaryAiAction?: ReactNode;
  descriptionAiAction?: ReactNode;
}

/**
 * Loads the specification suggestions the first time the Specifications tab
 * is shown. Rendered inside the tab, which mounts only while it is open, so
 * a product edited without touching its specifications never asks.
 */
function SpecificationSuggestionsLoader({
  endpoint,
  onLoad,
}: {
  endpoint?: string;
  onLoad: (suggestions: AttributeSuggestion[]) => void;
}) {
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    void loadAttributeSuggestions(endpoint).then((suggestions) => {
      if (!cancelled) onLoad(suggestions);
    });
    return () => {
      cancelled = true;
    };
  }, [endpoint, onLoad]);
  return null;
}

export function DetailsCard({
  form,
  attributeSuggestionsEndpoint,
  summaryAiAction,
  descriptionAiAction,
}: DetailsCardProps) {
  const t = useTranslations();
  const watchedTitle =
    useWatch({ control: form.control, name: "title" }) || "";
  const watchedHandle =
    useWatch({ control: form.control, name: "seo.handle" }) || "";
  // A handle already present when this card mounts belongs to an existing
  // product, so keep its public URL stable. New handles follow the title until
  // either this field or the SEO editor changes them to a custom value.
  const previousGeneratedHandleRef = useRef<string | null>(
    watchedHandle.trim() ? null : generateSearchHandle(watchedTitle),
  );
  const [attributeSuggestions, setAttributeSuggestions] = useState<
    AttributeSuggestion[]
  >([]);
  const watchedAttributes = useWatch({
    control: form.control,
    name: "attributes",
  });
  const specLabelListId = `${useId()}-spec-labels`;
  const specValueListId = `${useId()}-spec-values`;
  const {
    fields: attributeFields,
    append: appendAttribute,
    remove: removeAttribute,
  } = useFieldArray({ control: form.control, name: "attributes" });

  useEffect(() => {
    const generatedHandle = generateSearchHandle(watchedTitle);
    const currentHandle = watchedHandle.trim();
    const previousGeneratedHandle = previousGeneratedHandleRef.current;

    // Clearing a custom handle resumes title-based generation. This also keeps
    // the client payload aligned with the server's title fallback.
    if (!currentHandle) {
      if (currentHandle !== generatedHandle) {
        form.setValue("seo.handle", generatedHandle, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
      previousGeneratedHandleRef.current = generatedHandle;
      return;
    }

    if (
      previousGeneratedHandle !== null &&
      currentHandle === previousGeneratedHandle
    ) {
      if (currentHandle !== generatedHandle) {
        form.setValue("seo.handle", generatedHandle, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
      previousGeneratedHandleRef.current = generatedHandle;
      return;
    }

    // The value came from an inline/SEO edit (or was loaded from storage).
    // Stop following title changes until the handle is cleared.
    if (currentHandle !== generatedHandle) {
      previousGeneratedHandleRef.current = null;
    }
  }, [form, watchedHandle, watchedTitle]);

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>
          {t("admin.productForm.sections.details")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("admin.productForm.fields.title")}{" "}
                *
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={t(
                    "admin.productForm.placeholders.title",
                  )}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="seo.handle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("admin.productForm.seo.urlHandle")}
              </FormLabel>
              <div className="flex items-center">
                <span className="mr-1 whitespace-nowrap text-sm text-muted-foreground">
                  products/
                </span>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    maxLength={100}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="product-handle"
                    className="min-w-0 flex-1"
                    onChange={(event) =>
                      field.onChange(
                        sanitizeSearchHandle(event.target.value),
                      )
                    }
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="shortDescription"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-2">
                <FormLabel>
                  {t("admin.productForm.fields.summary")}
                </FormLabel>
                {summaryAiAction}
              </div>
              <FormControl>
                <Textarea
                  placeholder={t(
                    "admin.productForm.placeholders.summary",
                  )}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Tabs defaultValue="description" className="w-full">
          <TabsList>
            <TabsTrigger value="description">
              {t("admin.productForm.tabs.description")}
            </TabsTrigger>
            <TabsTrigger value="specifications">
              {t("admin.productForm.tabs.specifications")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="description" className="mt-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>
                      {t("admin.productForm.fields.description")}{" "}
                      *
                    </FormLabel>
                    {descriptionAiAction}
                  </div>
                  <FormControl>
                    <RichTextEditor
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t(
                        "admin.productForm.placeholders.description",
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="specifications" className="mt-4">
            <SpecificationSuggestionsLoader
              endpoint={attributeSuggestionsEndpoint}
              onLoad={setAttributeSuggestions}
            />
            {/* The label list: every label the catalogue uses that this
                product does not already have. */}
            <datalist id={specLabelListId}>
              {remainingAttributeSuggestions(
                attributeSuggestions,
                (watchedAttributes ?? []).map((row) => row?.name ?? ""),
              ).map((entry) => (
                <option key={entry.name} value={entry.name} />
              ))}
            </datalist>
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <FormLabel className="text-base">
                  {t("admin.productForm.tabs.specifications")}
                </FormLabel>
                <span className="text-xs text-muted-foreground">
                  {t("admin.productForm.optional")}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("admin.productForm.specificationsHelp")}
              </p>

              {attributeFields.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("admin.productForm.noSpecifications")}
                </div>
              ) : (
                <div className="space-y-2">
                  {attributeFields.map((field, index) => (
                    <div
                      key={field.id}
                      className="flex flex-col gap-2 sm:flex-row sm:items-start"
                    >
                      <FormField
                        control={form.control}
                        name={`attributes.${index}.name` as const}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input
                                placeholder={t(
                                  "admin.productForm.placeholders.specLabel",
                                )}
                                // Browser autocomplete would mix in whatever
                                // was typed on other sites; the list is the
                                // catalogue's own labels.
                                list={specLabelListId}
                                autoComplete="off"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`attributes.${index}.value` as const}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input
                                placeholder={t(
                                  "admin.productForm.placeholders.specValue",
                                )}
                                // The values products already use for THIS
                                // row's label — "130 mAh" once "Battery" is set.
                                list={`${specValueListId}-${index}`}
                                autoComplete="off"
                                {...field}
                              />
                            </FormControl>
                            <datalist id={`${specValueListId}-${index}`}>
                              {valuesForAttribute(
                                attributeSuggestions,
                                watchedAttributes?.[index]?.name ?? "",
                              ).map((value) => (
                                <option key={value} value={value} />
                              ))}
                            </datalist>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeAttribute(index)}
                        aria-label={t(
                          "admin.productForm.actions.removeSpecification",
                        )}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  appendAttribute({ name: "", value: "" })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("admin.productForm.actions.addSpecification")}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
