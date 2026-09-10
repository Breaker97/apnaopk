"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { ReturnPolicyPageView } from "@/components/store/return-policy-page-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import {
  CONTENT_PAGE_META,
  normalizeContentPagesSettings,
  type ReturnPolicyPageData,
  type ReturnPolicyRule,
  type ReturnPolicyStatusRow,
  type ReturnPolicyStep,
  type ReturnPolicyTextItem,
} from "@/lib/site-config/content-pages-config";
import { useAppSettings } from "@/providers/app-settings-provider";
import { FieldRow, SwitchRow } from "@/components/admin/online-store/editor-fields";
import { PageEditorSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import { isRecord } from "@/lib/utils";

type SettingsResponse = {
  success?: boolean;
  data?: {
    contentPages?: unknown;
  };
};

type TextListKey = "summaryItems" | "eligibleItems" | "excludedItems";
type DetailListKey = "steps" | "refundRules" | "statuses";

function cloneReturns(value: ReturnPolicyPageData): ReturnPolicyPageData {
  return JSON.parse(JSON.stringify(value)) as ReturnPolicyPageData;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createTextItem(prefix: string): ReturnPolicyTextItem {
  return {
    id: createId(prefix),
    text: "",
  };
}

function createStep(): ReturnPolicyStep {
  return {
    id: createId("step"),
    title: "",
    description: "",
  };
}

function createRule(): ReturnPolicyRule {
  return {
    id: createId("rule"),
    title: "",
    description: "",
  };
}

function createStatus(): ReturnPolicyStatusRow {
  return {
    id: createId("status"),
    label: "",
    description: "",
  };
}

export function ReturnPolicyPageEditor({ locale }: { locale: string }) {
  const pageMeta = CONTENT_PAGE_META.returns;
  // The preview stands in for the live page, so it renders the store's own
  // name and support details — the same ones the storefront reads.
  const { storeName, storeEmail, storePhone } = useAppSettings();
  const [page, setPage] = useState<ReturnPolicyPageData | null>(null);
  const [initialPage, setInitialPage] = useState<ReturnPolicyPageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/admin/settings", { method: "GET" });
        const payload = (await response.json()) as SettingsResponse;

        if (!response.ok || payload.success !== true || !isRecord(payload.data)) {
          throw new Error("Failed to load settings");
        }

        const normalized = normalizeContentPagesSettings(payload.data.contentPages);
        setPage(cloneReturns(normalized.returns));
        setInitialPage(cloneReturns(normalized.returns));
      } catch {
        toast.error("Failed to load Return and Refund Policy editor");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(page) !== JSON.stringify(initialPage),
    [page, initialPage],
  );

  const updateField = <K extends keyof ReturnPolicyPageData>(
    field: K,
    value: ReturnPolicyPageData[K],
  ) => {
    setPage((current) => (current ? { ...current, [field]: value } : current));
  };

  const updateTextItem = (
    key: TextListKey,
    id: string,
    value: string,
  ) => {
    setPage((current) =>
      current
        ? {
            ...current,
            [key]: current[key].map((item) =>
              item.id === id ? { ...item, text: value } : item,
            ),
          }
        : current,
    );
  };

  const addTextItem = (key: TextListKey) => {
    setPage((current) =>
      current
        ? {
            ...current,
            [key]: [...current[key], createTextItem(key)],
          }
        : current,
    );
  };

  const removeTextItem = (key: TextListKey, id: string) => {
    setPage((current) =>
      current
        ? {
            ...current,
            [key]: current[key].filter((item) => item.id !== id),
          }
        : current,
    );
  };

  const updateDetailItem = (
    key: DetailListKey,
    id: string,
    field: "title" | "label" | "description",
    value: string,
  ) => {
    setPage((current) => {
      if (!current) return current;

      const items = current[key].map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      );

      return { ...current, [key]: items };
    });
  };

  const addDetailItem = (key: DetailListKey) => {
    setPage((current) => {
      if (!current) return current;

      const newItem =
        key === "steps"
          ? createStep()
          : key === "refundRules"
            ? createRule()
            : createStatus();

      return {
        ...current,
        [key]: [...current[key], newItem],
      };
    });
  };

  const removeDetailItem = (key: DetailListKey, id: string) => {
    setPage((current) =>
      current
        ? {
            ...current,
            [key]: current[key].filter((item) => item.id !== id),
          }
        : current,
    );
  };

  const moveItem = (key: TextListKey | DetailListKey, index: number, direction: "up" | "down") => {
    setPage((current) => {
      if (!current) return current;

      const list = [...current[key]];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= list.length) return current;

      const item = list[index];
      list[index] = list[target];
      list[target] = item;

      return { ...current, [key]: list };
    });
  };

  const save = async () => {
    if (!page) return;

    try {
      setIsSaving(true);
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "contentPages",
          data: {
            returns: page,
          },
        }),
      });

      const payload = (await response.json()) as SettingsResponse;
      if (!response.ok || payload.success !== true || !isRecord(payload.data)) {
        throw new Error("Failed to save");
      }

      const normalized = normalizeContentPagesSettings(payload.data.contentPages);
      setPage(cloneReturns(normalized.returns));
      setInitialPage(cloneReturns(normalized.returns));
      toast.success("Return and Refund Policy saved successfully");
    } catch {
      toast.error("Failed to save Return and Refund Policy");
    } finally {
      setIsSaving(false);
    }
  };

  const openPreview = () => {
    window.open(`/${locale}${pageMeta.publicPath}`, "_blank", "noopener,noreferrer");
  };

  // Same placeholder as `pages/return-and-refund-policy/loading.tsx`.
  if (isLoading || !page) return <PageEditorSkeleton />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={pageMeta.adminTitle}
        description={pageMeta.description}
        status={
          <Badge variant={isDirty ? "secondary" : "default"}>
            {isDirty ? "Unsaved" : "Live"}
          </Badge>
        }
        actions={
          <>
            <Button asChild type="button" variant="outline" size="sm">
              <Link href="/admin/online-store/pages">Back to Pages</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={openPreview}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={!isDirty || isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </>
        }
      />

      <section className="rounded-sm border border-border bg-background shadow-[0_3px_14px_rgba(15,23,42,0.06)]">
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Live Preview
          </p>
        </div>
        <div className="max-h-[720px] overflow-y-auto">
          <ReturnPolicyPageView
            locale={locale}
            page={page}
            storeName={storeName}
            supportEmail={storeEmail}
            supportPhone={storePhone}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="space-y-4">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Hero</CardTitle>
              <CardDescription>
                Control the heading, intro copy, action labels, return window card, and visibility.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <FieldRow label="Badge text">
                  <Input
                    value={page.eyebrow}
                    onChange={(event) => updateField("eyebrow", event.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Page title">
                  <Input
                    value={page.title}
                    onChange={(event) => updateField("title", event.target.value)}
                  />
                </FieldRow>
              </div>
              <FieldRow label="Hero description">
                <Textarea
                  value={page.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  rows={4}
                />
              </FieldRow>
              <div className="grid gap-3 md:grid-cols-2">
                <FieldRow label="Primary button">
                  <Input
                    value={page.primaryActionLabel}
                    onChange={(event) =>
                      updateField("primaryActionLabel", event.target.value)
                    }
                  />
                </FieldRow>
                <FieldRow label="Secondary button">
                  <Input
                    value={page.secondaryActionLabel}
                    onChange={(event) =>
                      updateField("secondaryActionLabel", event.target.value)
                    }
                  />
                </FieldRow>
                <FieldRow label="Return window label">
                  <Input
                    value={page.returnWindowLabel}
                    onChange={(event) =>
                      updateField("returnWindowLabel", event.target.value)
                    }
                  />
                </FieldRow>
                <FieldRow label="Return window value">
                  <Input
                    value={page.returnWindowValue}
                    onChange={(event) =>
                      updateField("returnWindowValue", event.target.value)
                    }
                  />
                </FieldRow>
              </div>
              <SwitchRow
                label="Visible on storefront"
                description="Hide to temporarily unpublish this page."
                checked={page.visible}
                onChange={(value) => updateField("visible", value)}
              />
            </CardContent>
          </Card>

          <TextItemsEditor
            title="Return Window Card Bullets"
            description="These appear in the top-right summary card."
            items={page.summaryItems}
            onAdd={() => addTextItem("summaryItems")}
            onMove={(index, direction) => moveItem("summaryItems", index, direction)}
            onRemove={(id) => removeTextItem("summaryItems", id)}
            onUpdate={(id, value) => updateTextItem("summaryItems", id, value)}
          />

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>How a Return Works</CardTitle>
              <CardDescription>
                Edit the section intro and each step card.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow label="Section title">
                <Input
                  value={page.howItWorksTitle}
                  onChange={(event) =>
                    updateField("howItWorksTitle", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Section description">
                <Textarea
                  value={page.howItWorksDescription}
                  onChange={(event) =>
                    updateField("howItWorksDescription", event.target.value)
                  }
                  rows={3}
                />
              </FieldRow>
              <DetailItemsEditor
                kind="step"
                items={page.steps}
                onAdd={() => addDetailItem("steps")}
                onMove={(index, direction) => moveItem("steps", index, direction)}
                onRemove={(id) => removeDetailItem("steps", id)}
                onUpdate={(id, field, value) =>
                  updateDetailItem("steps", id, field, value)
                }
              />
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Refund Rules</CardTitle>
              <CardDescription>
                Edit the refund section intro and rule cards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow label="Section title">
                <Input
                  value={page.refundRulesTitle}
                  onChange={(event) =>
                    updateField("refundRulesTitle", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Section description">
                <Textarea
                  value={page.refundRulesDescription}
                  onChange={(event) =>
                    updateField("refundRulesDescription", event.target.value)
                  }
                  rows={4}
                />
              </FieldRow>
              <DetailItemsEditor
                kind="rule"
                items={page.refundRules}
                onAdd={() => addDetailItem("refundRules")}
                onMove={(index, direction) => moveItem("refundRules", index, direction)}
                onRemove={(id) => removeDetailItem("refundRules", id)}
                onUpdate={(id, field, value) =>
                  updateDetailItem("refundRules", id, field, value)
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <TextItemsEditor
            title={page.eligibleTitle || "Eligible Returns"}
            description="Edit the green eligibility cards."
            headingValue={page.eligibleTitle}
            headingLabel="Section title"
            onHeadingChange={(value) => updateField("eligibleTitle", value)}
            items={page.eligibleItems}
            onAdd={() => addTextItem("eligibleItems")}
            onMove={(index, direction) => moveItem("eligibleItems", index, direction)}
            onRemove={(id) => removeTextItem("eligibleItems", id)}
            onUpdate={(id, value) => updateTextItem("eligibleItems", id, value)}
          />

          <TextItemsEditor
            title={page.excludedTitle || "Items That May Not Qualify"}
            description="Edit the amber exclusion cards."
            headingValue={page.excludedTitle}
            headingLabel="Section title"
            onHeadingChange={(value) => updateField("excludedTitle", value)}
            items={page.excludedItems}
            onAdd={() => addTextItem("excludedItems")}
            onMove={(index, direction) => moveItem("excludedItems", index, direction)}
            onRemove={(id) => removeTextItem("excludedItems", id)}
            onUpdate={(id, value) => updateTextItem("excludedItems", id, value)}
          />

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Status Timeline</CardTitle>
              <CardDescription>
                Edit the status table shown near the bottom of the policy page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow label="Section title">
                <Input
                  value={page.statusesTitle}
                  onChange={(event) =>
                    updateField("statusesTitle", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Section description">
                <Textarea
                  value={page.statusesDescription}
                  onChange={(event) =>
                    updateField("statusesDescription", event.target.value)
                  }
                  rows={3}
                />
              </FieldRow>
              <DetailItemsEditor
                kind="status"
                items={page.statuses}
                onAdd={() => addDetailItem("statuses")}
                onMove={(index, direction) => moveItem("statuses", index, direction)}
                onRemove={(id) => removeDetailItem("statuses", id)}
                onUpdate={(id, field, value) =>
                  updateDetailItem("statuses", id, field, value)
                }
              />
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Help and CTA</CardTitle>
              <CardDescription>
                Edit the support aside and final order-review call to action.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow label="Before return title">
                <Input
                  value={page.beforeReturnTitle}
                  onChange={(event) =>
                    updateField("beforeReturnTitle", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Before return description">
                <Textarea
                  value={page.beforeReturnDescription}
                  onChange={(event) =>
                    updateField("beforeReturnDescription", event.target.value)
                  }
                  rows={4}
                />
              </FieldRow>
              <FieldRow label="Help title">
                <Input
                  value={page.helpTitle}
                  onChange={(event) => updateField("helpTitle", event.target.value)}
                />
              </FieldRow>
              <FieldRow label="CTA title">
                <Input
                  value={page.ctaTitle}
                  onChange={(event) => updateField("ctaTitle", event.target.value)}
                />
              </FieldRow>
              <FieldRow label="CTA description">
                <Textarea
                  value={page.ctaDescription}
                  onChange={(event) =>
                    updateField("ctaDescription", event.target.value)
                  }
                  rows={4}
                />
              </FieldRow>
              <div className="grid gap-3 md:grid-cols-2">
                <FieldRow label="CTA primary button">
                  <Input
                    value={page.ctaPrimaryLabel}
                    onChange={(event) =>
                      updateField("ctaPrimaryLabel", event.target.value)
                    }
                  />
                </FieldRow>
                <FieldRow label="CTA secondary button">
                  <Input
                    value={page.ctaSecondaryLabel}
                    onChange={(event) =>
                      updateField("ctaSecondaryLabel", event.target.value)
                    }
                  />
                </FieldRow>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {!isDirty ? (
        <p className="text-sm text-muted-foreground">
          All changes are saved. Return and Refund Policy is synced with storefront content.
        </p>
      ) : null}
    </div>
  );
}

function TextItemsEditor({
  title,
  description,
  headingValue,
  headingLabel,
  onHeadingChange,
  items,
  onAdd,
  onMove,
  onRemove,
  onUpdate,
}: {
  title: string;
  description: string;
  headingValue?: string;
  headingLabel?: string;
  onHeadingChange?: (value: string) => void;
  items: ReturnPolicyTextItem[];
  onAdd: () => void;
  onMove: (index: number, direction: "up" | "down") => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, value: string) => void;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {headingValue !== undefined && onHeadingChange ? (
          <FieldRow label={headingLabel || "Heading"}>
            <Input
              value={headingValue}
              onChange={(event) => onHeadingChange(event.target.value)}
            />
          </FieldRow>
        ) : null}
        <div className="space-y-3">
          {items.map((item, index) => (
            <EditableItemFrame
              key={item.id}
              index={index}
              total={items.length}
              onMove={onMove}
              onRemove={() => onRemove(item.id)}
            >
              <Textarea
                value={item.text}
                onChange={(event) => onUpdate(item.id, event.target.value)}
                rows={3}
                placeholder="Write policy text"
              />
            </EditableItemFrame>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailItemsEditor({
  kind,
  items,
  onAdd,
  onMove,
  onRemove,
  onUpdate,
}: {
  kind: "step" | "rule" | "status";
  items: Array<ReturnPolicyStep | ReturnPolicyRule | ReturnPolicyStatusRow>;
  onAdd: () => void;
  onMove: (index: number, direction: "up" | "down") => void;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    field: "title" | "label" | "description",
    value: string,
  ) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add {kind}
        </Button>
      </div>
      {items.map((item, index) => {
        const titleKey = kind === "status" ? "label" : "title";
        const titleValue =
          titleKey === "label"
            ? (item as ReturnPolicyStatusRow).label
            : (item as ReturnPolicyStep | ReturnPolicyRule).title;

        return (
          <EditableItemFrame
            key={item.id}
            index={index}
            total={items.length}
            onMove={onMove}
            onRemove={() => onRemove(item.id)}
          >
            <div className="space-y-3">
              <Input
                value={titleValue}
                onChange={(event) =>
                  onUpdate(item.id, titleKey, event.target.value)
                }
                placeholder={kind === "status" ? "Status label" : "Title"}
              />
              <Textarea
                value={item.description}
                onChange={(event) =>
                  onUpdate(item.id, "description", event.target.value)
                }
                rows={3}
                placeholder="Description"
              />
            </div>
          </EditableItemFrame>
        );
      })}
    </div>
  );
}

function EditableItemFrame({
  index,
  total,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  total: number;
  onMove: (index: number, direction: "up" | "down") => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          Item {index + 1}
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => onMove(index, "up")}
            disabled={index === 0}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => onMove(index, "down")}
            disabled={index === total - 1}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 text-rose-600 dark:text-rose-400"
            onClick={onRemove}
            disabled={total <= 1}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

