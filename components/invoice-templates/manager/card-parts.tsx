"use client";

/**
 * The pieces every card on Invoice Settings is built from (blank, preset and
 * template cards), so the three stay one card: the header with the name, its
 * status chip and the card's one quick action, as a slider card has its
 * Duplicate; and the picture, which opens the editor, says so on hover and
 * shows a spinner while an action on the card runs.
 */
import type { ReactNode } from "react";
import { Loader2, Pencil, Star } from "lucide-react";
import Link from "@/components/language/link";
import { cn } from "@/lib/utils";
import { CHIP_CLASS, THUMBNAIL_FRAME_CLASS } from "./card-styles";

export interface CardHeaderProps {
  name: string;
  /** The status word beside the name, if any. */
  chip?: { label: string; tone: "default" | "muted" };
  /** A small button on the right (Set as default). */
  action?: ReactNode;
}

export function CardHeader({ name, chip, action }: CardHeaderProps) {
  return (
    // min-h-8 keeps the pictures in a row level whether or not a card has a button here.
    <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-1 basis-36 items-center gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold leading-snug text-foreground" title={name}>
          {name}
        </h3>
        {chip && (
          <span
            className={cn(
              CHIP_CLASS,
              "inline-flex items-center gap-1",
              chip.tone === "default" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {chip.tone === "default" && <Star aria-hidden className="h-2.5 w-2.5 fill-current" />}
            {chip.label}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

export interface CardPictureProps {
  /** Where the picture leads; none when the card is off. */
  href?: string;
  label: string;
  /** The hint shown over the picture on hover. */
  hint?: string;
  busy?: boolean;
  /** The card is the category's default. */
  highlighted?: boolean;
  children: ReactNode;
}

export function CardPicture({ href, label, hint, busy, highlighted, children }: CardPictureProps) {
  const frame = cn(
    THUMBNAIL_FRAME_CLASS,
    "group/picture relative overflow-hidden",
    highlighted && "bg-primary/5",
  );
  const body = (
    <>
      <div className="transition-transform duration-300 ease-out group-hover/picture:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/picture:scale-100">
        {children}
      </div>
      {href && hint && !busy && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center opacity-0 transition-opacity duration-200 group-hover/picture:opacity-100 group-focus-visible/picture:opacity-100"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/85 px-3 py-1 text-xs font-medium text-background shadow-sm">
            <Pencil className="h-3 w-3" />
            {hint}
          </span>
        </span>
      )}
      {busy && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-background/40">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </span>
      )}
    </>
  );

  if (!href) return <div className={frame}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(frame, "transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      aria-label={label}
    >
      {body}
    </Link>
  );
}
