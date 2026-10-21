"use client";

/**
 * The template's name in the toolbar, renamed in place (§5.2): click it to
 * edit; Enter or leaving the field commits; Esc cancels. An empty name, or
 * one another template of the category already has, is refused inline and
 * the field stays open. The new name is part of the document: it marks the
 * template unsaved and goes out with the next Save.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TEMPLATE_LIMITS } from "@/lib/invoice-templates/types";
import { useEditor, useEditorApi } from "./editor-store";
import { nameProblem } from "./save-flow";

export interface TemplateNameFieldProps {
  isNameTaken?: (name: string) => boolean;
  /** A name the server refused on the last save. */
  serverError?: string;
  onEdited: () => void;
  disabled?: boolean;
}

export function TemplateNameField({ isNameTaken, serverError, onEdited, disabled }: TemplateNameFieldProps) {
  const t = useTranslations("admin.invoiceTemplates.editor");
  const tDraft = useTranslations("admin.invoiceTemplates.draft");
  const api = useEditorApi();
  const name = useEditor((state) => state.name);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<"required" | "taken" | null>(null);
  // Esc closes the field; the blur that may follow must not commit what was typed.
  const closing = useRef(false);

  const start = () => {
    closing.current = false;
    setText(name);
    setProblem(null);
    setEditing(true);
  };
  const commit = () => {
    if (closing.current) return;
    const state = api.getState();
    const found = nameProblem(text, isNameTaken, state.isDraft ? undefined : state.baseline.name);
    if (found) {
      setProblem(found);
      return;
    }
    const next = text.trim();
    if (next !== state.name) {
      state.setName(next);
      onEdited();
    }
    setProblem(null);
    closing.current = true;
    setEditing(false);
  };
  const cancel = () => {
    closing.current = true;
    setProblem(null);
    setEditing(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const message = problem === "required" ? tDraft("nameRequired") : problem === "taken" ? t("name.taken") : serverError;

  return (
    <div className="relative flex min-w-0 items-center">
      {editing ? (
        <Input
          autoFocus
          id="template-name"
          aria-label={tDraft("nameLabel")}
          value={text}
          maxLength={TEMPLATE_LIMITS.nameLength}
          onChange={(event) => {
            setText(event.target.value);
            if (problem) setProblem(null);
          }}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={onKeyDown}
          onBlur={commit}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? "template-name-error" : undefined}
          className="h-9 w-40 text-sm font-semibold sm:w-48 2xl:w-60"
        />
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          aria-label={t("name.rename", { name })}
          title={name}
          aria-describedby={message ? "template-name-error" : undefined}
          data-template-name=""
          className="group flex h-9 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring 2xl:max-w-[18rem]"
        >
          <span className="truncate">{name}</span>
          <Pencil aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" />
        </button>
      )}
      {message && (
        <p
          id="template-name-error"
          role="alert"
          className="absolute start-0 top-full z-30 mt-1 w-max max-w-[18rem] rounded-md border bg-popover px-2 py-1 text-xs text-destructive shadow-md"
        >
          {message}
        </p>
      )}
    </div>
  );
}
