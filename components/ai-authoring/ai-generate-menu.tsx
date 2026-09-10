"use client";

/**
 * AiGenerateMenu — a reusable, NON-modal AI generation menu.
 *
 * Interaction model (by design, not a modal):
 *  - Opens when its trigger button is clicked.
 *  - Stays open while the mouse moves, and while the page scrolls
 *    (it just repositions with its anchor).
 *  - A left-click outside the menu (and outside its trigger) dismisses it,
 *    as does a right-click anywhere; a page reload clears it (open state is
 *    client-only).
 *  - It does NOT close on Escape — it behaves like a lightweight menu, not a
 *    dialog.
 *
 * It is field-agnostic: give it a `request`, an `onGenerate` and an `onApply`
 * and it drops onto any text field (summary, description, SEO, other pages…).
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowUp, Loader2, Plus, RefreshCw, X } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AiGenerateButton } from "@/components/ai-authoring/ai-generate-button";
import {
  uploadImageFile,
  type UploadedImage,
} from "@/components/ai-authoring/upload-image";
import { toast } from "@/components/ui/toast-notification";
import {
  AI_AUTHORING_TONES,
  type AIAuthoringRequest,
  type AIAuthoringTone,
} from "@/lib/ai-authoring/types";
import { useStudioStrings } from "@/components/ai-authoring/studio/use-studio-strings";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

// Rainbow frame around the menu. The hue rotates around the border to match
// the reference: pastel green (top-left) → cyan (top-right) → orange
// (bottom-right) → vivid hot-pink (bottom-left), boldest along the bottom.
const AI_GRADIENT =
  "conic-gradient(from 0deg at 50% 50%, #86e6b8 0deg, #2fe0e0 50deg, #7fe0c8 95deg, #ffaf5c 140deg, #ff6f8f 185deg, #ff2c9c 225deg, #ff6fb5 270deg, #cbe88f 320deg, #86e6b8 360deg)";

// Only one AI menu is open at a time across the whole page. A single shared
// "which menu id is open" value is the source of truth; each menu derives its
// own open state from it via useSyncExternalStore, so opening one inherently
// closes every other — two can never be open together.
let currentOpenMenuId: string | null = null;
const menuStoreListeners = new Set<() => void>();

function subscribeMenuStore(listener: () => void) {
  menuStoreListeners.add(listener);
  return () => menuStoreListeners.delete(listener);
}
function getOpenMenuId() {
  return currentOpenMenuId;
}
function setOpenMenuId(id: string | null) {
  if (currentOpenMenuId === id) return;
  currentOpenMenuId = id;
  menuStoreListeners.forEach((listener) => listener());
}

type AiGenerateMenuProps<T> = {
  /** Trigger button label (used for the aria-label / tooltip). */
  label?: string;
  /** Render the trigger as the compact icon-only AI button (default). */
  iconOnly?: boolean;
  triggerClassName?: string;
  /** Guard run before opening; return false to veto (e.g. to show a toast). */
  canOpen?: () => boolean;
  /** Placeholder for the empty prompt box. */
  placeholder?: string;
  /** Character bounds forwarded to the AI so a save never fails validation. */
  minChars?: number;
  maxChars?: number;
  /** Treat a string result as HTML when previewing it. */
  format?: "text" | "html";
  /** Show the "+" reference-image attach control. */
  allowAttachment?: boolean;
  /** Popover placement relative to the trigger. */
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  /** AI context + callbacks (same contract as the AI dialogs). */
  request: AIAuthoringRequest;
  loading?: boolean;
  onGenerate: (request: AIAuthoringRequest) => Promise<T | null>;
  /**
   * Streaming variant. When set, generation goes through this instead of
   * `onGenerate` and `onDelta` text is shown live in the preview box; the
   * resolved value is applied exactly like a non-streamed result.
   */
  onGenerateStream?: (
    request: AIAuthoringRequest,
    onDelta: (text: string) => void,
  ) => Promise<T | null>;
  /** Hide the tone picker (it shows by default for text generation). */
  showTonePicker?: boolean;
  onApply: (value: T) => void;
  /**
   * Turn a result into display text for the in-menu preview. Needed when the
   * result isn't a plain string (e.g. a structured SEO draft). Defaults to the
   * value itself (HTML stripped when `format` is "html").
   */
  previewText?: (value: T) => string;
};

function toPlainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function AiGenerateMenu<T = string>({
  label = "Generate",
  iconOnly = true,
  triggerClassName,
  canOpen,
  placeholder = "Describe what you want the AI to write…",
  minChars,
  maxChars,
  format = "text",
  allowAttachment = true,
  align = "end",
  side = "bottom",
  request,
  loading = false,
  onGenerate,
  onGenerateStream,
  showTonePicker = true,
  onApply,
  previewText,
}: AiGenerateMenuProps<T>) {
  const strings = useStudioStrings();
  const menuId = useId();
  // Derived from the shared store: this menu is open iff it owns the store.
  const openMenuId = useSyncExternalStore(
    subscribeMenuStore,
    getOpenMenuId,
    () => null,
  );
  const open = openMenuId === menuId;
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) setOpenMenuId(menuId);
      else if (currentOpenMenuId === menuId) setOpenMenuId(null);
    },
    [menuId],
  );
  const [prompt, setPrompt] = useState("");
  const [attachment, setAttachment] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [tone, setTone] = useState<string>("");
  const [streamText, setStreamText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  // Fresh state every time the menu opens (or the request behind it changes).
  useApplyOnChange([open, request.prompt, request.constraints?.tone], () => {
    if (!open) return;
    setPrompt(request.prompt || "");
    setAttachment(null);
    setResult(null);
    setTone(request.constraints?.tone || "");
    setStreamText("");
  });

  // Then focus the prompt box.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      textareaRef.current?.focus();
      resizeTextarea();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, resizeTextarea]);

  // Right-click anywhere dismisses the menu (reload clears it on its own).
  useEffect(() => {
    if (!open) return;
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [open, setOpen]);

  // A left-click outside the menu — and outside its trigger — dismisses it.
  // Clicks on the trigger are ignored here so `toggleOpen` owns that toggle and
  // the menu doesn't close-then-reopen on the same press.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.button !== 0) return; // left button only; right-click handled above
      const target = event.target as Node | null;
      if (!target) return;
      if (contentRef.current?.contains(target)) return; // inside the menu
      if (anchorRef.current?.contains(target)) return; // on the trigger button
      // The tone picker (Radix Select) renders its dropdown in a portal outside
      // this menu's DOM. Selecting a tone must not be read as an outside click,
      // so ignore anything inside a Radix popper/select portal.
      if (
        target instanceof Element &&
        target.closest(
          "[data-radix-popper-content-wrapper],[data-slot='select-content']",
        )
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, setOpen]);

  // Release the shared store if this menu is removed while open, so a remounted
  // menu that reuses the same id doesn't inherit a phantom "open" state.
  useEffect(() => {
    return () => {
      if (currentOpenMenuId === menuId) setOpenMenuId(null);
    };
  }, [menuId]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (canOpen && !canOpen()) return;
    setOpen(true); // owning the shared store closes any other open menu
  };

  // The user's prompt is weighted heavily so the result closely follows it.
  const buildRequest = (auto: boolean): AIAuthoringRequest => {
    const ceiling = maxChars ?? request.constraints?.maxLength;
    const trimmed = prompt.trim();
    const parts: string[] = [];
    if (trimmed) {
      parts.push(
        auto
          ? trimmed
          : `Follow these instructions exactly and prioritise them above all defaults: ${trimmed}`,
      );
    }
    if (minChars && ceiling) {
      parts.push(
        `The result must be between ${minChars} and ${ceiling} characters, and must never exceed ${ceiling} characters.`,
      );
    } else if (ceiling) {
      parts.push(`The result must not exceed ${ceiling} characters.`);
    } else if (minChars) {
      parts.push(`The result must be at least ${minChars} characters.`);
    }
    const composed = parts.join(" ");
    return {
      ...request,
      prompt: composed || undefined,
      ...(attachment?.url ? { sourceUrl: attachment.url } : {}),
      constraints: {
        ...request.constraints,
        ...(ceiling ? { maxLength: ceiling } : {}),
        ...(tone ? { tone: tone as AIAuthoringTone } : {}),
      },
    };
  };

  const run = async (auto: boolean) => {
    if (loading) return;
    const built = buildRequest(auto);
    let value: T | null;
    if (onGenerateStream) {
      setStreamText("");
      setResult(null);
      value = await onGenerateStream(built, (text) => setStreamText(text));
      setStreamText("");
    } else {
      value = await onGenerate(built);
    }
    if (value) {
      onApply(value);
      setResult(value);
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setAttachment(await uploadImageFile(file));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not attach image",
      );
    } finally {
      setUploading(false);
    }
  };

  const resultPreview =
    result != null
      ? previewText
        ? previewText(result)
        : format === "html"
          ? toPlainText(String(result))
          : String(result)
      : "";

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverAnchor asChild>
        <span ref={anchorRef} className="inline-flex">
          <AiGenerateButton
            iconOnly={iconOnly}
            label={label}
            loading={loading}
            className={triggerClassName}
            onClick={toggleOpen}
          />
        </span>
      </PopoverAnchor>

      <PopoverContent
        ref={contentRef}
        align={align}
        side={side}
        sideOffset={8}
        // Keep the panel clear of the viewport edges so it never clips off-screen
        // on narrow (mobile) widths, and let Radix shift it back into view.
        collisionPadding={8}
        avoidCollisions
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        // pointer-events-auto keeps the menu clickable when it opens from inside
        // a modal dialog (Radix sets pointer-events:none on the body there); it
        // is a no-op on non-modal pages where the body is already interactive.
        className="pointer-events-auto w-[min(92vw,400px)] max-w-[calc(100vw-16px)] border-0 bg-transparent p-0 shadow-none"
      >
        <div
          className="rounded-md p-[3px] pb-3 shadow-xl"
          style={{ backgroundImage: AI_GRADIENT }}
        >
          <div className="flex flex-col rounded-md bg-popover">
            <div className="flex flex-col gap-2 p-3">
              {attachment ? (
                <div className="relative h-16 w-16 overflow-hidden rounded-lg border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachment.url}
                    alt="Reference"
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    aria-label="Remove image"
                    className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : null}

              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  resizeTextarea();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void run(false);
                  }
                }}
                rows={2}
                placeholder={placeholder}
                className="max-h-[220px] min-h-[56px] w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              />

              {streamText ? (
                <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                  {toPlainText(streamText)}
                  <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-[1px] bg-foreground/50 align-middle" />
                </div>
              ) : resultPreview ? (
                <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                  {resultPreview}
                </div>
              ) : null}

              {showTonePicker ? (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                    {strings.toneLabel}
                  </span>
                  <Select
                    value={tone || "__default__"}
                    onValueChange={(value) =>
                      setTone(value === "__default__" ? "" : value)
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-7 w-auto min-w-0 max-w-full gap-1 border-0 bg-muted/50 px-2 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[60]">
                      <SelectItem value="__default__">{strings.defaultTone}</SelectItem>
                      {AI_AUTHORING_TONES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
              {allowAttachment ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || loading}
                  aria-label="Attach image"
                  title="Attach image"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-foreground/70 transition hover:bg-muted disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-5 w-5" />
                  )}
                </button>
              ) : (
                <span className="h-8 w-8 shrink-0" />
              )}

              <button
                type="button"
                onClick={() => void run(true)}
                disabled={loading}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{strings.autoGenerate}</span>
              </button>

              <button
                type="button"
                onClick={() => void run(false)}
                disabled={loading}
                aria-label="Generate"
                title="Generate"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {allowAttachment ? (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
