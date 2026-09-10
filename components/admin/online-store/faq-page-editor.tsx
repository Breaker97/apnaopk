"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { ContentPageEditorSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import {
  CONTENT_PAGE_META,
  normalizeContentPagesSettings,
  type FaqItem,
} from "@/lib/site-config/content-pages-config";
import { isRecord } from "@/lib/utils";

type SettingsResponse = {
  success?: boolean;
  data?: {
    contentPages?: unknown;
  };
};

function createFaqItem(index: number): FaqItem {
  return {
    id: `faq-${Date.now()}-${index}`,
    question: "",
    answer: "",
  };
}

export function FaqPageEditor({ locale }: { locale: string }) {
  const pageMeta = CONTENT_PAGE_META.faq;

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [visible, setVisible] = useState(true);
  const [items, setItems] = useState<FaqItem[]>([]);

  const [initialTitle, setInitialTitle] = useState("");
  const [initialSubtitle, setInitialSubtitle] = useState("");
  const [initialVisible, setInitialVisible] = useState(true);
  const [initialItems, setInitialItems] = useState<FaqItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
          throw new Error("Failed to load settings");
        }

        const normalized = normalizeContentPagesSettings(
          payload.data.contentPages,
        );
        setTitle(normalized.faq.title);
        setSubtitle(normalized.faq.subtitle);
        setVisible(normalized.faq.visible);
        setItems(normalized.faq.items);

        setInitialTitle(normalized.faq.title);
        setInitialSubtitle(normalized.faq.subtitle);
        setInitialVisible(normalized.faq.visible);
        setInitialItems(normalized.faq.items);
      } catch {
        toast.error("Failed to load FAQ editor");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const isDirty = useMemo(() => {
    return (
      title !== initialTitle ||
      subtitle !== initialSubtitle ||
      visible !== initialVisible ||
      JSON.stringify(items) !== JSON.stringify(initialItems)
    );
  }, [
    title,
    subtitle,
    visible,
    items,
    initialTitle,
    initialSubtitle,
    initialVisible,
    initialItems,
  ]);

  const updateItem = (
    id: string,
    key: "question" | "answer",
    value: string,
  ) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    setItems((prev) => {
      const next = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;

      const current = next[index];
      next[index] = next[target];
      next[target] = current;
      return next;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, createFaqItem(prev.length + 1)]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const save = async () => {
    try {
      setIsSaving(true);
      const sanitizedItems = items
        .map((item) => ({
          ...item,
          question: item.question.trim(),
          answer: item.answer.trim(),
        }))
        .filter((item) => item.question || item.answer);

      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "contentPages",
          data: {
            faq: {
              title,
              subtitle,
              visible,
              items: sanitizedItems,
            },
          },
        }),
      });

      const payload = (await response.json()) as SettingsResponse;
      if (!response.ok || payload.success !== true || !isRecord(payload.data)) {
        throw new Error("Failed to save");
      }

      const normalized = normalizeContentPagesSettings(
        payload.data.contentPages,
      );
      setTitle(normalized.faq.title);
      setSubtitle(normalized.faq.subtitle);
      setVisible(normalized.faq.visible);
      setItems(normalized.faq.items);

      setInitialTitle(normalized.faq.title);
      setInitialSubtitle(normalized.faq.subtitle);
      setInitialVisible(normalized.faq.visible);
      setInitialItems(normalized.faq.items);

      toast.success("FAQ saved successfully");
    } catch {
      toast.error("Failed to save FAQ");
    } finally {
      setIsSaving(false);
    }
  };

  const openPreview = () => {
    window.open(
      `/${locale}${pageMeta.publicPath}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Same placeholder as `pages/faq/loading.tsx`.
  if (isLoading) return <ContentPageEditorSkeleton />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={pageMeta.adminTitle}
        description={pageMeta.description}
        actions={
          <>
            <Button asChild type="button" variant="outline" size="sm">
              <Link href="/admin/online-store/pages">Back to Pages</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openPreview}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </>
        }
      />

      <Card className="rounded-sm border border-border bg-card p-4 shadow-[0_3px_14px_rgba(15,23,42,0.06)] md:p-6">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Page Title
              </p>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Frequently Asked Questions"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Subtitle
              </p>
              <Input
                value={subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
                placeholder="Short helper text for your shoppers"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Visibility
            </p>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Visible on storefront
                </p>
                <p className="text-xs text-muted-foreground">
                  Hide to temporarily unpublish this page.
                </p>
              </div>
              <Switch checked={visible} onCheckedChange={setVisible} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Questions & Answers
            </p>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-2 h-4 w-4" />
              Add Question
            </Button>
          </div>

          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-background p-3.5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">
                    Question {index + 1}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      onClick={() => moveItem(index, "up")}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      onClick={() => moveItem(index, "down")}
                      disabled={index === items.length - 1}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 text-rose-600 dark:text-rose-400"
                      onClick={() => removeItem(item.id)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Input
                    value={item.question}
                    onChange={(event) =>
                      updateItem(item.id, "question", event.target.value)
                    }
                    placeholder="Write a customer question"
                  />
                  <Textarea
                    value={item.answer}
                    onChange={(event) =>
                      updateItem(item.id, "answer", event.target.value)
                    }
                    placeholder="Write a helpful answer"
                    rows={4}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border border-border bg-card p-4 shadow-[0_3px_14px_rgba(15,23,42,0.06)] md:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Live Preview
        </p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}

        <Accordion
          type="single"
          collapsible
          className="mt-4 rounded-xl border border-border px-4"
        >
          {items.map((item) => (
            <AccordionItem key={item.id} value={item.id}>
              <AccordionTrigger className="text-base font-medium hover:no-underline">
                {item.question || "Untitled question"}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                {item.answer || "No answer yet."}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Card>

      {!isDirty && (
        <p className="text-sm text-muted-foreground">
          All changes are saved. FAQ is synced with storefront content.
        </p>
      )}
    </div>
  );
}
