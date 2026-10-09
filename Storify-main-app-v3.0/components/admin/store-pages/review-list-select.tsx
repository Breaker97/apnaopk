"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BadgeCheck, GripVertical, Loader2, Plus, Search, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/** A review as the picker lists it (GET /api/vendor/store-page/reviews). */
interface ReviewOption {
  id: string;
  rating: number;
  title?: string;
  excerpt: string;
  authorName: string;
  productName: string;
  isVerified: boolean;
}

/**
 * Hand-picked reviews for Review Highlights: the picks in display order
 * (drag to reorder), and the store's approved reviews — newest first, with a
 * search over the words — to add more. Only approved reviews of the store's
 * own products are offered, and the words are shown, never editable.
 *
 * A pick the store can no longer quote (unapproved since, or deleted) stays
 * in the list, marked, so the vendor sees why the page shows one fewer.
 */
export function ReviewListSelect({
  endpoint,
  value,
  onChange,
  title,
  max,
  labels,
}: {
  endpoint: string;
  value: string[];
  onChange: (ids: string[]) => void;
  title: string;
  max?: number;
  labels: {
    search: string;
    empty: string;
    noResults: string;
    unavailable: string;
    remove: string;
    reorder: string;
    limitReached: string;
    verified: string;
  };
}) {
  const [catalog, setCatalog] = useState<Map<string, ReviewOption>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReviewOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const remember = (reviews: ReviewOption[]) =>
    setCatalog((current) => {
      const next = new Map(current);
      for (const review of reviews) next.set(review.id, review);
      return next;
    });

  const fetchReviews = async (params: Record<string, string>) => {
    const search = new URLSearchParams(params).toString();
    const list = await apiClient.get<ReviewOption[]>(
      search ? `${endpoint}?${search}` : endpoint,
    );
    return Array.isArray(list) ? list : [];
  };

  // The newest reviews double as the default suggestions; the picks are read
  // back by id so a pick past the first page still shows its words.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchReviews({}),
      value.length > 0 ? fetchReviews({ ids: value.join(",") }) : Promise.resolve([]),
    ])
      .then(([latest, picked]) => {
        if (!cancelled) remember([...latest, ...picked]);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // The picks only need labelling once; later picks come from the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  useApplyOnChange([query], () => {
    if (query.trim().length < 2) {
      setResults(null);
      setSearching(false);
    } else {
      setSearching(true);
    }
  });
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const term = query.trim();
    if (term.length < 2) return;
    debounce.current = setTimeout(() => {
      fetchReviews({ search: term })
        .then((reviews) => {
          remember(reviews);
          setResults(reviews);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const picked = new Set(value);
  const atMax = max !== undefined && value.length >= max;
  const suggestions = (results ?? [...catalog.values()]).filter(
    (review) => !picked.has(review.id),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = value.indexOf(String(active.id));
    const to = value.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(value, from, to));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <span className="text-[11px] text-muted-foreground">
          {max !== undefined ? `${value.length} / ${max}` : value.length}
        </span>
      </div>

      {value.length > 0 ? (
        <DndContext
          id="review-list-select"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={value} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {value.map((id, index) => (
                <PickedRow
                  key={id}
                  id={id}
                  index={index}
                  review={catalog.get(id)}
                  // Until the lists answer, a missing review is "loading",
                  // not "unavailable".
                  unavailable={loaded && !catalog.has(id)}
                  labels={labels}
                  onRemove={() => onChange(value.filter((pick) => pick !== id))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {labels.empty}
        </p>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          className="pl-8"
          disabled={atMax}
        />
        {searching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {atMax ? (
        <p className="text-xs text-muted-foreground">{labels.limitReached}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-card">
          {!loaded && results === null ? (
            <div className="flex justify-center p-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : suggestions.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {labels.noResults}
            </p>
          ) : (
            suggestions.map((review) => (
              <button
                key={review.id}
                type="button"
                onClick={() => {
                  onChange([...value, review.id]);
                  setQuery("");
                }}
                className="flex w-full items-start gap-3 border-b border-border/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/50"
              >
                <ReviewSummary review={review} verifiedLabel={labels.verified} />
                <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ReviewSummary({
  review,
  verifiedLabel,
}: {
  review: ReviewOption;
  verifiedLabel: string;
}) {
  return (
    <span className="min-w-0 flex-1 space-y-0.5">
      <span className="flex items-center gap-1.5">
        <Stars rating={review.rating} />
        {review.isVerified ? (
          <BadgeCheck
            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
            aria-label={verifiedLabel}
          />
        ) : null}
        <span className="truncate text-[11px] text-muted-foreground">
          {[review.authorName, review.productName].filter(Boolean).join(" · ")}
        </span>
      </span>
      {review.title ? (
        <span className="block truncate text-xs font-semibold">{review.title}</span>
      ) : null}
      <span className="line-clamp-2 block text-xs text-muted-foreground">
        {review.excerpt}
      </span>
    </span>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex shrink-0" aria-label={`${rating} / 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={cn(
            "h-3 w-3",
            index < rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/40",
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

function PickedRow({
  id,
  index,
  review,
  unavailable,
  labels,
  onRemove,
}: {
  id: string;
  index: number;
  review: ReviewOption | undefined;
  unavailable: boolean;
  labels: { unavailable: string; remove: string; reorder: string; verified: string };
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5",
        isDragging && "z-10 shadow-md",
        unavailable && "opacity-60",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none p-1 text-muted-foreground"
        aria-label={labels.reorder}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="mt-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
        {index + 1}
      </span>
      {review ? (
        <ReviewSummary review={review} verifiedLabel={labels.verified} />
      ) : (
        <span className="min-w-0 flex-1 truncate py-1 text-sm font-medium">
          {unavailable ? labels.unavailable : "…"}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
        aria-label={labels.remove}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
