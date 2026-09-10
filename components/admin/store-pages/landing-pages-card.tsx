"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  FileText,
  Loader2,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { slugifyPageHandle } from "@/lib/storefront/pages/handles";
import { lt } from "@/lib/storefront/sections/localized";
import type { LocalizedText } from "@/lib/storefront/sections/types";

export interface LandingPageSummary {
  handle: string;
  title: LocalizedText;
  isPublished: boolean;
}

/**
 * Section-built landing pages: list, create, delete. Editing opens the same
 * builder the home page uses. Lives above the legacy custom-pages manager —
 * rebuilding a custom page here under the same handle replaces it on the
 * storefront without a URL change.
 */
export function LandingPagesCard({
  locale,
  defaultLanguage,
  initialPages,
}: {
  locale: string;
  defaultLanguage: string;
  initialPages: LandingPageSummary[];
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const router = useRouter();

  const [pages, setPages] = useState(initialPages);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  // The handle auto-follows the title until the admin edits it by hand —
  // essential for non-Latin titles, whose auto-slug is empty.
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteHandle, setDeleteHandle] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const effectiveHandle = handleTouched ? handle : slugifyPageHandle(title);
  const canCreate = title.trim().length > 0 && effectiveHandle.length > 0;

  const create = async () => {
    setCreating(true);
    try {
      const page = await apiClient.post<LandingPageSummary>(
        "/api/admin/store-pages",
        { title, handle: effectiveHandle },
      );
      setCreateOpen(false);
      setTitle("");
      setHandle("");
      setHandleTouched(false);
      router.push(
        `/${locale}/admin/online-store/customize?page=${encodeURIComponent(page.handle)}`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.storeBuilder.actionFailed", "The action failed"),
      );
    } finally {
      setCreating(false);
    }
  };

  const remove = async (handle: string) => {
    setDeleting(true);
    try {
      await apiClient.delete(`/api/admin/store-pages/${handle}`);
      setPages((current) =>
        current.filter((page) => page.handle !== handle),
      );
      toast.success(
        tSafe("admin.storeBuilder.landing.deleted", "Landing page deleted"),
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.storeBuilder.actionFailed", "The action failed"),
      );
    } finally {
      setDeleting(false);
      setDeleteHandle(null);
    }
  };

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-4 w-4 text-primary" />
            {tSafe("admin.storeBuilder.landing.title", "Landing pages")}
          </CardTitle>
          <CardDescription>
            {tSafe(
              "admin.storeBuilder.landing.subtitle",
              "Section-built pages from the theme engine, edited with the same builder as the home page.",
            )}
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          {tSafe("admin.storeBuilder.landing.new", "New page")}
        </Button>
      </CardHeader>
      <CardContent>
        {pages.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {tSafe(
              "admin.storeBuilder.landing.empty",
              "No landing pages yet. Create one to build a campaign or About page from sections.",
            )}
          </p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {pages.map((page) => (
              <div
                key={page.handle}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {lt(page.title, locale, defaultLanguage) || page.handle}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    /pages/{page.handle}
                  </p>
                </div>
                <Badge
                  variant={page.isPublished ? "secondary" : "outline"}
                  className="rounded-md"
                >
                  {page.isPublished
                    ? tSafe("admin.storeBuilder.landing.live", "Live")
                    : tSafe("admin.storeBuilder.landing.draft", "Draft")}
                </Badge>
                {page.isPublished ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                  >
                    <Link
                      href={`/${locale}/pages/${page.handle}`}
                      target="_blank"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : null}
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  <Link
                    href={`/${locale}/admin/online-store/customize?page=${encodeURIComponent(page.handle)}`}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    {tSafe("admin.storeBuilder.landing.edit", "Edit")}
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                  onClick={() => setDeleteHandle(page.handle)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tSafe("admin.storeBuilder.landing.new", "New page")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={tSafe(
                "admin.storeBuilder.landing.titlePlaceholder",
                "Page title (e.g. About Us)",
              )}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canCreate) void create();
              }}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">/pages/</span>
              <Input
                value={effectiveHandle}
                onChange={(event) => {
                  setHandleTouched(true);
                  setHandle(slugifyPageHandle(event.target.value));
                }}
                placeholder={tSafe(
                  "admin.storeBuilder.landing.handlePlaceholder",
                  "url-handle",
                )}
                className="h-8 font-mono text-xs"
              />
            </div>
            {title.trim() && !effectiveHandle ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {tSafe(
                  "admin.storeBuilder.landing.handleRequired",
                  "Add a URL handle in Latin letters or numbers — this title can't be turned into one automatically.",
                )}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={!canCreate || creating}
              onClick={() => void create()}
              className="gap-1.5"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {tSafe("admin.storeBuilder.landing.create", "Create page")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteHandle !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteHandle(null);
        }}
        title={tSafe(
          "admin.storeBuilder.landing.deleteTitle",
          "Delete this landing page?",
        )}
        description={tSafe(
          "admin.storeBuilder.landing.deleteDescription",
          "The page and its sections are removed permanently. A published page disappears from the storefront.",
        )}
        confirmText={tSafe("admin.storeBuilder.landing.delete", "Delete")}
        loading={deleting}
        onConfirm={() => {
          if (deleteHandle) void remove(deleteHandle);
        }}
      />
    </Card>
  );
}
