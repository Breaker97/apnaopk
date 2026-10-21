"use client";

/**
 * The save flow's dialogs (§5.2):
 * - **Save as…**: a name for the copy (refused inline when empty or taken).
 * - **Conflict** (409 `stale_version`): someone saved the template after it
 *   was opened, or after the local copy restored here was made. Reload
 *   (their version; the edits here go) or Overwrite (save these edits onto
 *   their version) or Cancel (keep editing, nothing saved).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMPLATE_LIMITS } from "@/lib/invoice-templates/types";
import { useEditor } from "./editor-store";
import { copyNameTaken, nameProblem } from "./save-flow";

export interface SaveAsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
  isNameTaken?: (name: string) => boolean;
  /** The server refused the name. */
  serverError?: string;
  onEdited: () => void;
}

export function SaveAsDialog({ open, onOpenChange, onSubmit, isNameTaken, serverError, onEdited }: SaveAsDialogProps) {
  const t = useTranslations("admin.invoiceTemplates.editor.saveAs");
  const tEditor = useTranslations("admin.invoiceTemplates.editor");
  const tDraft = useTranslations("admin.invoiceTemplates.draft");
  const savedName = useEditor((state) => state.baseline.name);
  const saving = useEditor((state) => state.save.status === "saving" && state.save.kind === "saveAs");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<"required" | "taken" | null>(null);
  const [opened, setOpened] = useState(false);
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setName(t("defaultName", { name: savedName }).slice(0, TEMPLATE_LIMITS.nameLength));
      setProblem(null);
    }
  }
  const message = problem === "required" ? tDraft("nameRequired") : problem === "taken" ? tEditor("name.taken") : serverError;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { name: savedName })}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const found = nameProblem(name, copyNameTaken(isNameTaken, savedName));
            if (found) return setProblem(found);
            onSubmit(name.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="save-as-name">{t("label")}</Label>
            <Input
              id="save-as-name"
              autoFocus
              value={name}
              maxLength={TEMPLATE_LIMITS.nameLength}
              onChange={(event) => {
                setName(event.target.value);
                setProblem(null);
                onEdited();
              }}
              aria-invalid={Boolean(message)}
              aria-describedby={message ? "save-as-name-error" : undefined}
              disabled={saving}
            />
            {message && (
              <p id="save-as-name-error" role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface ConflictDialogProps {
  /** The edits came from a restored local copy older than the version opened (use-draft-recovery.ts). */
  restored?: boolean;
  onReload: () => void;
  onOverwrite: (currentVersion: number) => void;
}

/** Open while the save machine is in `conflict` after a Save. */
export function ConflictDialog({ restored = false, onReload, onOverwrite }: ConflictDialogProps) {
  const t = useTranslations("admin.invoiceTemplates.editor.conflict");
  const save = useEditor((state) => state.save);
  const name = useEditor((state) => state.baseline.name);
  const dismiss = useEditor((state) => state.dispatchSave);
  const open = save.status === "conflict" && save.kind === "save";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss({ type: "dismiss" })}>
      <DialogContent className="sm:max-w-md" data-conflict-dialog="">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t(restored ? "restoredDescription" : "description", { name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => dismiss({ type: "dismiss" })}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="outline" onClick={onReload}>
            {t("reload")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => save.currentVersion !== undefined && onOverwrite(save.currentVersion)}>
            {t("overwrite")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
