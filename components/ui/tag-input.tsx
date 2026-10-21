"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  AnimatePresence,
  motion,
  useAnimate,
  useReducedMotion,
} from "motion/react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { cn } from "@/lib/utils";

/**
 * Tags keep the field still: a new tag blurs in where its text was typed while
 * the caret glides aside, a removed tag leaves its slot and the rest glide in,
 * and the shell follows wrapped rows on a spring. Backspace or the arrow keys
 * pick a tag first, a ring glides to it, and the next Backspace removes it. A
 * duplicate pulses the tag already there instead of being added twice.
 *
 * The motion follows Arc UI's tag input (uiarc.dev/components/tag-input); the
 * field around it is ours, so it sits next to an `<Input>` without a seam.
 */

const MOTION = {
  duration: { instant: 0.12, fast: 0.16, standard: 0.24 },
  ease: {
    enter: [0.16, 1, 0.3, 1],
    standard: [0.22, 1, 0.36, 1],
    inOut: [0.65, 0, 0.35, 1],
  },
  spring: {
    snappy: { type: "spring", visualDuration: 0.26, bounce: 0.12 },
    smooth: { type: "spring", visualDuration: 0.4, bounce: 0 },
    morph: { type: "spring", visualDuration: 0.42, bounce: 0.16 },
  },
  blur: { subtle: 2, soft: 4 },
} as const;

/** A tag as it sits inside a `[data-tag="…"]` selector. */
function escapeAttr(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

export interface TagInputProps {
  /** Controlled tags. Leave out (with `defaultValue`) for an uncontrolled field. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  id?: string;
  name?: string;
  /** A label of the field's own; most forms draw theirs and pass `id` instead. */
  label?: string;
  placeholder?: string;
  /** Helper copy under the field; it opens and closes on a spring. */
  description?: string;
  disabled?: boolean;
  /** At most this many tags; the field says so when one more is tried. */
  maxTags?: number;
  /** Longest a single tag may be. */
  maxLength?: number;
  /** Each tag as it is kept, e.g. `(tag) => tag.toLowerCase()`. */
  normalize?: (tag: string) => string;
  onBlur?: () => void;
  /** `sm` fits a 32px field, as in a side panel. */
  size?: "default" | "sm";
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/** Changed words rise in and unblur while unchanged words hold still. */
function MotionText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const words = text.split(" ");
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="relative block">
        <AnimatePresence initial={false} mode="popLayout">
          {words.map((word, index) => (
            <motion.span
              key={`${index}:${word}`}
              className="inline-block whitespace-pre"
              initial={
                reduced
                  ? { opacity: 0 }
                  : { opacity: 0, y: "0.35em", filter: `blur(${MOTION.blur.soft}px)` }
              }
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      y: "-0.35em",
                      filter: `blur(${MOTION.blur.subtle}px)`,
                      transition: {
                        duration: MOTION.duration.instant,
                        ease: [...MOTION.ease.standard],
                      },
                    }
              }
              transition={
                reduced
                  ? { duration: MOTION.duration.instant }
                  : { duration: MOTION.duration.standard, ease: [...MOTION.ease.enter] }
              }
            >
              {index < words.length - 1 ? `${word} ` : word}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    </>
  );
}

/** The row tracks the measured copy, so a longer message that wraps opens its next line instead of snapping. */
function MessageRow({ id, text }: { id?: string; text: string }) {
  const reduced = useReducedMotion();
  const copyRef = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useEffect(() => {
    const node = copyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Reduced motion mounts the row at full height: a zero-duration open would
  // still paint one collapsed frame.
  return (
    <motion.span
      className="block overflow-hidden"
      initial={reduced ? false : { height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={{
        height: 0,
        opacity: 0,
        transition: reduced
          ? { duration: 0 }
          : { height: MOTION.spring.smooth, opacity: { duration: MOTION.duration.instant } },
      }}
      transition={
        reduced
          ? { duration: 0 }
          : { height: MOTION.spring.smooth, opacity: { duration: MOTION.duration.fast } }
      }
    >
      <motion.span
        ref={copyRef}
        id={id}
        className="block pt-1.5 text-xs text-muted-foreground"
        initial={reduced ? false : { y: "0.35em", filter: `blur(${MOTION.blur.soft}px)` }}
        animate={{ y: 0, filter: "blur(0px)" }}
        transition={{
          duration: reduced ? 0 : MOTION.duration.standard,
          ease: [...MOTION.ease.enter],
        }}
      >
        <MotionText text={text} />
      </motion.span>
    </motion.span>
  );
}

export function TagInput({
  value,
  defaultValue = [],
  onValueChange,
  id,
  name,
  label,
  placeholder,
  description,
  disabled,
  maxTags,
  maxLength,
  normalize,
  onBlur,
  size = "default",
  className,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
}: TagInputProps) {
  const tSafe = useFallbackTranslator(useTranslations());
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = description ? `${inputId}-description` : undefined;
  const [internal, setInternal] = useState(defaultValue);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const ringAt = useRef("");
  // The shell follows its wrapped rows on a spring instead of jumping when a
  // tag starts or leaves a line.
  const [height, setHeight] = useState<number | "auto">("auto");

  const small = size === "sm";
  const tags = value ?? internal;
  const active = picked !== null && tags.includes(picked) ? picked : null;
  const shownPlaceholder = placeholder ?? tSafe("admin.tagInput.placeholder", "Add a tag");

  useEffect(() => {
    const node = contentRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The ring measures the picked tag's resting box, glides between picks, and
  // fades in place when the pick clears.
  useLayoutEffect(() => {
    const ring = ringRef.current;
    const node =
      active === null
        ? null
        : contentRef.current?.querySelector<HTMLElement>(`[data-tag="${escapeAttr(active)}"]`);
    if (!ring) return;
    // It leaves on the same curve as a removed tag, so a picked tag and its
    // ring fade out as one piece.
    if (!node) {
      if (ringAt.current) {
        animate(
          ring,
          reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 },
          { duration: reduced ? 0 : MOTION.duration.instant, ease: [...MOTION.ease.standard] },
        );
      }
      ringAt.current = "";
      return;
    }
    const box = {
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    const at = Object.values(box).join(" ");
    if (at === ringAt.current) return;
    // A ring that is still fading from the last pick glides on to the next
    // one, so quick Backspaces read as one motion.
    if (!reduced && (ringAt.current || Number(getComputedStyle(ring).opacity) > 0.02)) {
      animate(
        ring,
        { ...box, opacity: 1, scale: 1 },
        { ...MOTION.spring.morph, opacity: { duration: MOTION.duration.fast } },
      );
    } else {
      animate(
        ring,
        { ...box, opacity: [0, 1], scale: [reduced ? 1 : 0.9, 1] },
        reduced
          ? { duration: 0, opacity: { duration: MOTION.duration.instant } }
          : {
              duration: 0,
              opacity: { duration: MOTION.duration.fast },
              scale: MOTION.spring.snappy,
            },
      );
    }
    ringAt.current = at;
  });

  /** Said to assistive tech; repeating a message still re-announces it. */
  const say = (message: string) =>
    setNotice((previous) => (previous === message ? `${message} ` : message));

  const update = (next: string[]) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  const pick = (tag: string | null) => {
    setPicked(tag);
    if (tag !== null) {
      say(
        tSafe(
          "admin.tagInput.selected",
          "{tag} selected. Press Backspace to remove it.",
          { tag },
        ),
      );
    }
  };

  const pulse = (tag: string) => {
    const node = scope.current?.querySelector(`[data-tag="${escapeAttr(tag)}"]`);
    if (node && !reduced) {
      animate(node, { scale: [1, 1.06, 1] }, {
        duration: MOTION.duration.standard + MOTION.duration.instant,
        ease: [...MOTION.ease.inOut],
      });
    }
  };

  /**
   * Keep each of `entries` that may be kept, in order. A duplicate pulses the
   * tag that already exists, so the ignored Enter still gets an answer.
   * Returns the entries that were turned away for length, so a typed one can
   * stay in the field to be shortened.
   */
  const keep = (entries: string[]): string[] => {
    const next = [...tags];
    const turnedAway: string[] = [];
    const added: string[] = [];
    for (const entry of entries) {
      const tag = (normalize ? normalize(entry.trim()) : entry.trim()).trim();
      if (!tag) continue;
      const existing = next.find((item) => item.toLowerCase() === tag.toLowerCase());
      if (existing) {
        pulse(existing);
        say(tSafe("admin.tagInput.duplicate", "{tag} is already added", { tag: existing }));
        continue;
      }
      if (maxLength !== undefined && tag.length > maxLength) {
        turnedAway.push(entry);
        say(
          tSafe("admin.tagInput.tooLong", "A tag can be up to {max} characters", {
            max: maxLength,
          }),
        );
        continue;
      }
      if (maxTags !== undefined && next.length >= maxTags) {
        turnedAway.push(entry);
        say(tSafe("admin.tagInput.tooMany", "You can add up to {max} tags", { max: maxTags }));
        continue;
      }
      next.push(tag);
      added.push(tag);
    }
    if (added.length > 0) {
      update(next);
      setPicked(null);
      say(
        tSafe("admin.tagInput.added", "Added {tag}", { tag: added.join(", ") }),
      );
    }
    return turnedAway;
  };

  const add = () => {
    if (!draft.trim()) return;
    const turnedAway = keep([draft]);
    // A duplicate or a tag that normalised to nothing clears the field; one
    // that was too long or over the cap stays, to be fixed.
    setDraft(turnedAway.length > 0 ? draft : "");
  };

  const remove = (tag: string) => {
    update(tags.filter((item) => item !== tag));
    setPicked(null);
    say(tSafe("admin.tagInput.removed", "Removed {tag}", { tag }));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const { key, currentTarget: input } = event;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const index = active === null ? tags.length : tags.indexOf(active);
    let handled = true;
    if (key === "Enter" || key === ",") add();
    else if ((key === "Backspace" || key === "Delete") && active !== null) remove(active);
    else if (key === "Backspace" && atStart && tags.length) pick(tags[tags.length - 1]!);
    else if (key === "ArrowLeft" && (atStart || active !== null) && index > 0) pick(tags[index - 1]!);
    else if (key === "ArrowRight" && active !== null) pick(tags[index + 1] ?? null);
    else if (key === "Escape" && active !== null) pick(null);
    else handled = false;
    if (handled) event.preventDefault();
  };

  // A pasted list ("a, b, c" or one per line) becomes tags at once.
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!/[,\n\r]/.test(text)) return;
    event.preventDefault();
    const parts = text.split(/[,\n\r]/);
    parts[0] = draft + parts[0];
    // Whatever was turned away (too long, over the cap) stays to be fixed.
    setDraft(keep(parts.filter((part) => part.trim())).join(", "));
  };

  // A click on a tag picks it without taking focus from the field. The remove
  // button keeps its own press.
  const onTagPointer = (event: MouseEvent<HTMLElement>, tag?: string) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (!tag) {
      event.preventDefault();
      return;
    }
    if (disabled) return;
    pick(active === tag ? null : tag);
    inputRef.current?.focus();
  };

  const move = reduced ? { duration: 0 } : MOTION.spring.morph;
  const glide = reduced ? { duration: 0 } : MOTION.spring.smooth;

  return (
    <div data-slot="tag-input" className={cn("grid w-full min-w-0", className)}>
      {label ? (
        <label htmlFor={inputId} className="mb-2 text-sm font-medium">
          {label}
        </label>
      ) : null}
      <motion.div
        ref={scope}
        initial={false}
        animate={{ height }}
        transition={glide}
        aria-invalid={ariaInvalid || undefined}
        className={cn(
          // The shell animates its height to the content, which carries the
          // wrapping rows, so it sizes by content-box.
          "box-content overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30",
          "focus-within:border-ring focus-within:ring-[1px] focus-within:ring-ring/30",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          disabled && "pointer-events-none cursor-not-allowed opacity-50",
        )}
      >
        <div
          ref={contentRef}
          // Equal padding makes one row fill the field exactly (36px, or 32px
          // when small), so existing tags hold their line when a second row
          // opens.
          className={cn(
            "relative box-border flex cursor-text flex-wrap content-start items-center gap-1.5",
            small ? "min-h-[30px] p-[3px]" : "min-h-[34px] p-[5px]",
          )}
          onClick={(event) => {
            if (event.target === event.currentTarget) inputRef.current?.focus();
          }}
        >
          <span
            ref={ringRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-[1] box-border rounded-full border border-primary bg-primary/10 opacity-0"
          />
          <AnimatePresence initial={false}>
            {!draft && !tags.length && (
              <motion.span
                key="placeholder"
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap text-muted-foreground",
                  small ? "ps-2 text-xs" : "ps-2.5 text-sm",
                )}
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 0, y: "0.3em", filter: `blur(${MOTION.blur.soft}px)` }
                }
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, transition: { duration: 0 } }}
                transition={
                  reduced
                    ? { duration: MOTION.duration.instant }
                    : { duration: MOTION.duration.standard, ease: [...MOTION.ease.enter] }
                }
              >
                {shownPlaceholder}
              </motion.span>
            )}
          </AnimatePresence>
          <AnimatePresence initial={false} mode="popLayout">
            {tags.map((tag) => (
              <motion.span
                key={tag}
                layout={reduced ? false : "position"}
                data-tag={tag}
                data-picked={tag === active || undefined}
                className={cn(
                  "relative inline-flex min-h-6 cursor-default items-center gap-[3px] whitespace-nowrap rounded-full border border-border bg-muted pe-[3px] text-foreground",
                  small ? "ps-2 text-[11px]" : "ps-2.5 text-xs",
                )}
                onMouseDown={(event) => onTagPointer(event)}
                onClick={(event) => onTagPointer(event, tag)}
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.9, filter: `blur(${MOTION.blur.soft}px)` }
                }
                animate={{
                  opacity: 1,
                  scale: 1,
                  filter: "blur(0px)",
                  transitionEnd: { filter: "none" },
                }}
                exit={
                  reduced
                    ? { opacity: 0, transition: { duration: 0 } }
                    : {
                        opacity: 0,
                        scale: 0.9,
                        filter: `blur(${MOTION.blur.subtle}px)`,
                        transition: {
                          duration: MOTION.duration.instant,
                          ease: [...MOTION.ease.standard],
                        },
                      }
                }
                transition={
                  reduced
                    ? { duration: MOTION.duration.instant }
                    : {
                        ...MOTION.spring.morph,
                        layout: move,
                        opacity: { duration: MOTION.duration.fast, ease: [...MOTION.ease.enter] },
                        filter: { duration: MOTION.duration.standard, ease: [...MOTION.ease.enter] },
                      }
                }
              >
                {/* A resting tag is not a stacking context (its filter ends at
                    none), so its label and button sit above the ring while its
                    fill stays below. */}
                <span className="relative z-[2]">{tag}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(tag)}
                  aria-label={tSafe("admin.tagInput.remove", "Remove {tag}", { tag })}
                  className="relative z-[2] grid size-[18px] cursor-pointer place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform] hover:bg-background hover:text-foreground focus-visible:bg-background focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring active:scale-95"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          <motion.input
            layout={reduced ? false : "position"}
            transition={{ layout: move }}
            ref={inputRef}
            id={inputId}
            name={name}
            type="text"
            value={draft}
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setPicked(null);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              add();
              setPicked(null);
              onBlur?.();
            }}
            placeholder={tags.length ? "" : shownPlaceholder}
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={[hintId, describedBy].filter(Boolean).join(" ") || undefined}
            autoComplete="off"
            spellCheck={false}
            // The visible placeholder is drawn above, so it can rise in when
            // the last tag leaves; the native one stays for assistive tech.
            className={cn(
              "min-h-6 min-w-20 flex-[1_1_100px] border-0 bg-transparent px-[5px] outline-none placeholder:text-transparent",
              small ? "text-xs" : "text-base md:text-sm",
            )}
          />
        </div>
      </motion.div>
      <span className="sr-only" aria-live="polite">
        {notice}
      </span>
      <AnimatePresence initial={false}>
        {description ? <MessageRow key="message" id={hintId} text={description} /> : null}
      </AnimatePresence>
    </div>
  );
}
