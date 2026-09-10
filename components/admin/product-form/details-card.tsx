"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
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
import {
  generateSearchHandle,
  sanitizeSearchHandle,
} from "@/components/admin/search-engine-listing-preview";

interface DetailsCardProps {
  form: UseFormReturn<ProductFormData>;
  summaryAiAction?: ReactNode;
  descriptionAiAction?: ReactNode;
}

export function DetailsCard({
  form,
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
                                {...field}
                              />
                            </FormControl>
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
