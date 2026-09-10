"use client";

import { useState } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import type { createTSafe } from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/**
 * Names and saves one configured section into the library. The library
 * stores a COPY — later edits to the page never touch it, and inserting it
 * elsewhere clones it again with fresh ids.
 */
export function SaveSectionDialog({
  section,
  onOpenChange,
  tSafe,
  onSaveRefused,
}: {
  section: SectionInstance | null;
  onOpenChange: (open: boolean) => void;
  tSafe: ReturnType<typeof createTSafe>;
  /** Returns true when the save must not be sent (demo deployments). */
  onSaveRefused?: () => boolean;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useApplyOnChange([section], () => {
    if (section) setName("");
  });

  const save = async () => {
    if (!section) return;
    if (onSaveRefused?.()) return;
    setSaving(true);
    try {
      await apiClient.post("/api/admin/store-pages/saved-sections", {
        name,
        section,
      });
      toast.success(
        tSafe("admin.storeBuilder.savedToLibrary", "Section saved to library"),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.storeBuilder.actionFailed", "The action failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={section !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-primary" />
            {tSafe("admin.storeBuilder.saveToLibrary", "Save to library")}
          </DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={tSafe(
            "admin.storeBuilder.savedSectionName",
            "Name (e.g. Summer promo banner)",
          )}
          maxLength={80}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void save();
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            disabled={!name.trim() || saving}
            onClick={() => void save()}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {tSafe("admin.storeBuilder.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
