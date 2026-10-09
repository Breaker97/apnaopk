"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Package,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { apiClient } from "@/lib/api/client";
import { useStoreBuilderScope } from "./builder-scope";
import { composeCollectionShelf } from "@/lib/storefront/sections/collection-shelf";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import type {
  CollectionProductsResult,
  ProductPickerItem,
} from "@/types/product-list";

/** The most the endpoint hands over at once — what the select lists unsearched. */
const PAGE_SIZE = 100;

/** A line standing where the select would, when there is nothing to pick from. */
const NOTE =
  "rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground";


function indexById(
  products: ProductPickerItem[],
): Record<string, ProductPickerItem> {
  return Object.fromEntries(products.map((product) => [product._id, product]));
}

/**
 * The endpoint's `search`, run over products already in hand: typing narrows
 * the list at once, and the server is asked only for what is not loaded.
 */
function matchesTerm(product: ProductPickerItem, term: string): boolean {
  const needle = term.toLowerCase();
  return [product.name, product.title, product.sku].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

/**
 * Hand-placing a Featured Collection row's products.
 *
 * The select on top — the app's one select-with-search — offers the row's
 * collection and nothing else: a product from another collection cannot be
 * reached from here, which is the rule the storefront enforces again when it
 * draws the row. Choosing a product gives it the next slot; the list
 * underneath is the shelf in order, where the numbers are the positions
 * beside the feature image and the dashed rows are the slots still left to
 * the collection, named so nothing on the store is a surprise.
 *
 * Every change is written to the row at once, like the feature dialog beside
 * it: the row preview underneath follows, and Done only closes.
 */
export function CollectionPicksDialog({
  collectionId,
  collectionTitle,
  limit,
  picks,
  onChange,
  onClose,
  tSafe,
}: {
  collectionId: string;
  collectionTitle: string;
  /** The row's card count — as many products as can be placed. */
  limit: number;
  picks: string[];
  onChange: (picks: string[]) => void;
  onClose: () => void;
  tSafe: TSafe;
}) {
  const { formatPrice } = useCurrency();
  // The builder's own route: the admin's, or a vendor's (its products only).
  const path = useStoreBuilderScope().collectionProductsEndpoint(collectionId);

  // The collection's first page, and which of the row's picks it still
  // offers. Null until it lands.
  const [base, setBase] = useState<CollectionProductsResult | null>(null);
  const [failed, setFailed] = useState(false);
  // Every product the collection has shown this dialog, by id. A pick that
  // is NOT in here once `base` has landed is one the collection dropped.
  const [known, setKnown] = useState<Record<string, ProductPickerItem>>({});
  // What is typed into the select's search box, as the select reports it.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  // Asked about once, on open: picks made in here come off the list, so
  // they are known already.
  const openedWith = useRef(picks);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<CollectionProductsResult>(path, {
        query: { limit: PAGE_SIZE, picked: openedWith.current.join(",") },
      })
      .then((payload) => {
        if (cancelled) return;
        setBase(payload);
        setKnown((current) => ({
          ...current,
          ...indexById(payload.products),
          ...indexById(payload.picked),
        }));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const term = query.trim();
  // A collection that came over whole is searched right here. A longer one is
  // searched on the server as well, for the products past the first page.
  const beyondFirstPage = Boolean(
    base && base.total > base.products.length,
  );
  useApplyOnChange([term, beyondFirstPage], () => {
    setSearching(Boolean(term) && beyondFirstPage);
  });
  useEffect(() => {
    if (!term || !beyondFirstPage) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiClient
        .get<CollectionProductsResult>(path, {
          query: { limit: PAGE_SIZE, search: term },
        })
        .then((payload) => {
          if (cancelled) return;
          setKnown((current) => ({
            ...current,
            ...indexById(payload.products),
          }));
        })
        // The products already in hand still answer the search.
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, term, beyondFirstPage]);

  const atCapacity = picks.length >= limit;

  // What the select offers: the collection in its own order or, once
  // something is typed, every product of it seen so far that matches — the
  // loaded ones first. A product already placed is not offered twice.
  const options = useMemo(() => {
    if (!base) return [];
    const loaded = new Set(base.products.map((product) => product._id));
    const pool = term
      ? [
          ...base.products,
          ...Object.values(known).filter((product) => !loaded.has(product._id)),
        ].filter((product) => matchesTerm(product, term))
      : base.products;
    return pool
      .filter((product) => !picks.includes(product._id))
      .map((product) => ({
        value: product._id,
        label: product.title || product.name,
        icon: <ProductThumb product={product} small />,
      }));
  }, [base, known, picks, term]);

  const add = (productId: string) => {
    if (atCapacity || picks.includes(productId)) return;
    onChange([...picks, productId]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= picks.length) return;
    onChange(arrayMove(picks, from, to));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = picks.indexOf(String(active.id));
    const to = picks.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(picks, from, to));
  };

  // The shelf as the store will draw it: the picks the collection still
  // offers, then whatever it fills the remaining slots with — the same rule
  // the storefront row runs, over the same ordered list.
  const { slots, auto } = useMemo(() => {
    const chosen = picks.flatMap((id) => (known[id] ? [known[id]] : []));
    const slotOf = new Map(chosen.map((product, index) => [product._id, index + 1]));
    if (!base) return { slots: slotOf, auto: [] as ProductPickerItem[] };
    const { cards } = composeCollectionShelf(base.products, chosen, limit);
    return { slots: slotOf, auto: cards.slice(Math.min(chosen.length, limit)) };
  }, [base, known, picks, limit]);
  const placed = Math.min(slots.size, limit);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        // One explicit column: the dialog's implicit auto column would grow
        // to the longest product name instead of truncating it.
        className="max-h-[85vh] grid-cols-1 overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6 text-base leading-snug">
            {tSafe(
              "admin.storeBuilder.featuredCollection.picksTitle",
              `Products from ${collectionTitle}`,
              { collection: collectionTitle },
            )}
          </DialogTitle>
        </DialogHeader>

        {failed ? (
          <p role="alert" className={NOTE}>
            {tSafe(
              "admin.storeBuilder.featuredCollection.picksFailed",
              "Could not load this collection's products.",
            )}
          </p>
        ) : base && base.total === 0 ? (
          <p className={NOTE}>
            {tSafe(
              "admin.storeBuilder.featuredCollection.picksEmpty",
              "This collection has no products on the online store yet.",
            )}
          </p>
        ) : (
          <SearchableSelect
            // Inside a dialog: the list needs the scroll lock for itself.
            modal
            // Nothing stays selected: a choice goes straight onto the shelf.
            value=""
            options={options}
            onValueChange={add}
            // The matching is done here — by name, title and SKU, and on the
            // server for a collection longer than one page.
            onSearch={setQuery}
            disabled={!base || atCapacity}
            icon={<Search className="size-4 shrink-0 text-muted-foreground" />}
            placeholder={
              !base
                ? tSafe(
                    "admin.storeBuilder.featuredCollection.picksLoading",
                    "Loading products…",
                  )
                : atCapacity
                  ? tSafe(
                      "admin.storeBuilder.featuredCollection.picksFull",
                      `All ${limit} cards are chosen. Remove one to add another.`,
                      { count: limit },
                    )
                  : tSafe(
                      "admin.storeBuilder.featuredCollection.picksAdd",
                      "Add a product…",
                    )
            }
            // A long collection lists its first page only — the count says
            // the rest is a search away.
            searchPlaceholder={
              base && beyondFirstPage
                ? tSafe(
                    "admin.storeBuilder.featuredCollection.picksSearchAll",
                    `Search all ${base.total} products…`,
                    { count: base.total },
                  )
                : tSafe(
                    "admin.storeBuilder.featuredCollection.picksSearch",
                    "Search in this collection…",
                  )
            }
            emptyText={
              searching
                ? tSafe(
                    "admin.storeBuilder.featuredCollection.picksSearching",
                    "Searching…",
                  )
                : term
                  ? tSafe(
                      "admin.storeBuilder.featuredCollection.picksNoMatch",
                      "No products in this collection match.",
                    )
                  : tSafe(
                      "admin.storeBuilder.featuredCollection.picksAllChosen",
                      "Every product in this collection is already chosen.",
                    )
            }
          />
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/60">
              {tSafe(
                "admin.storeBuilder.featuredCollection.picksSelected",
                "Selected",
              )}
            </span>
            <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border">
              {picks.length} / {limit}
            </span>
            {picks.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-xs text-muted-foreground"
                onClick={() => onChange([])}
              >
                {tSafe(
                  "admin.storeBuilder.featuredCollection.picksClear",
                  "Clear all",
                )}
              </Button>
            ) : null}
          </div>

          {picks.length > 0 || auto.length > 0 ? (
            <div className="overflow-hidden rounded-[10px] border bg-card">
              <DndContext
                id="collection-picks"
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={picks}
                  strategy={verticalListSortingStrategy}
                >
                  {picks.map((id, index) => (
                    <PickRow
                      key={id}
                      id={id}
                      product={known[id]}
                      slot={slots.get(id)}
                      // Until the collection has answered, a pick it has not
                      // named yet is still loading, not missing.
                      pending={!base && !failed}
                      first={index === 0}
                      last={index === picks.length - 1}
                      formatPrice={formatPrice}
                      tSafe={tSafe}
                      onUp={() => move(index, index - 1)}
                      onDown={() => move(index, index + 1)}
                      onRemove={() =>
                        onChange(picks.filter((pick) => pick !== id))
                      }
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {auto.map((product, index) => (
                <div
                  key={product._id}
                  className={cn(
                    "flex items-center gap-2.5 bg-muted/30 py-1.5 pl-2 pr-3",
                    (picks.length > 0 || index > 0) &&
                      "border-t border-dashed",
                  )}
                >
                  {/* Holds the grip's place, so the numbers line up. */}
                  <span className="w-4 shrink-0" aria-hidden />
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {placed + index + 1}
                  </span>
                  <ProductThumb product={product} dimmed />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {product.title || product.name}
                  </span>
                  <span className="shrink-0 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
                    {tSafe(
                      "admin.storeBuilder.featuredCollection.picksAuto",
                      "Auto",
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <Button type="button" className="w-full" onClick={onClose}>
          {tSafe("admin.storeBuilder.sliderBlock.done", "Done")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ProductThumb({
  product,
  dimmed,
  small,
}: {
  product?: ProductPickerItem;
  dimmed?: boolean;
  /** The size that sits in a select's option row. */
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted",
        small ? "h-7 w-7" : "h-9 w-9",
        dimmed && "opacity-60",
      )}
    >
      {product?.images?.[0] ? (
        <AppImage
          src={product.images[0]}
          alt=""
          fill
          className="object-cover"
          sizes={small ? "28px" : "36px"}
        />
      ) : (
        <Package className="h-4 w-4 text-muted-foreground" />
      )}
    </span>
  );
}

/**
 * One hand-placed product. The number is its position on the shelf — a pick
 * the collection no longer offers has none, because the store skips it, and
 * says so instead.
 */
function PickRow({
  id,
  product,
  slot,
  pending,
  first,
  last,
  formatPrice,
  tSafe,
  onUp,
  onDown,
  onRemove,
}: {
  id: string;
  product?: ProductPickerItem;
  slot?: number;
  pending: boolean;
  first: boolean;
  last: boolean;
  formatPrice: (value: number) => string;
  tSafe: TSafe;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const missing = !product && !pending;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2.5 bg-card py-1.5 pl-2 pr-1.5",
        !first && "border-t",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        aria-label={tSafe(
          "admin.storeBuilder.featuredCollection.picksReorder",
          "Drag to reorder",
        )}
        className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {missing ? (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4" />
        </span>
      ) : (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
          {slot ?? "·"}
        </span>
      )}
      <ProductThumb product={product} />
      <div className="min-w-0 flex-1">
        {product ? (
          <>
            <div className="truncate text-sm font-medium">
              {product.title || product.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatPrice(product.price)}
            </div>
          </>
        ) : missing ? (
          <div className="text-sm text-amber-600 dark:text-amber-400">
            {tSafe(
              "admin.storeBuilder.featuredCollection.pickUnavailable",
              "Not available in this collection",
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {tSafe(
              "admin.storeBuilder.featuredCollection.picksLoading",
              "Loading products…",
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {/* Keyboard and touch fallback for the drag handle. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={tSafe(
            "admin.storeBuilder.featuredCollection.picksMoveUp",
            "Move up",
          )}
          className="text-muted-foreground"
          disabled={first}
          onClick={onUp}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={tSafe(
            "admin.storeBuilder.featuredCollection.picksMoveDown",
            "Move down",
          )}
          className="text-muted-foreground"
          disabled={last}
          onClick={onDown}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={tSafe(
            "admin.storeBuilder.featuredCollection.picksRemove",
            "Remove",
          )}
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
