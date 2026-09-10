"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AppImage } from "@/components/ui/app-image";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Package,
  Search,
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
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { apiClient } from "@/lib/api/client";
import type { ProductPickerItem as Product } from "@/types/product-list";


interface CollectionProductSelectorProps {
  selectedProducts: string[];
  onChange: (productIds: string[]) => void;
  /**
   * Rows the collection payload already carried for the current selection.
   * `GET /api/admin/collections/[id]` populates exactly the fields rendered
   * here, so seeding from it means the picker normally needs no lookups of its
   * own. Display order still comes from `selectedProducts`.
   */
  initialProducts?: Product[];
  title?: string;
  /**
   * Extra search filters, as query-string pairs — `{ onSale: "true" }` keeps
   * a deals picker to products that actually carry a deal.
   */
  query?: Record<string, string>;
  /**
   * How many picks the consuming section can use. Reached, the search rows
   * stop accepting new ones — better than silently dropping the extras at
   * render, where the merchant would never learn why.
   */
  max?: number;
}

function indexById(products: Product[] | undefined): Record<string, Product> {
  return Object.fromEntries(
    (products ?? []).map((product) => [product._id, product]),
  );
}

export function CollectionProductSelector({
  selectedProducts,
  onChange,
  initialProducts,
  title = "Products in Collection",
  max,
  query: extraQuery,
}: CollectionProductSelectorProps) {
  const { formatPrice } = useCurrency();
  const [searchValue, setSearchValue] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productDetails, setProductDetails] = useState<Record<string, Product>>(
    () => indexById(initialProducts),
  );
  const [isSearching, setIsSearching] = useState(false);
  // Ids already looked up, so a product that no longer resolves (deleted while
  // the collection still references it) is not requested again on every render.
  const requestedIds = useRef(new Set<string>());

  // Hydrate only what the seed is missing — usually nothing. The lookups are
  // issued together; this used to await one request per selected product inside
  // the loop, and re-ran for the whole selection on every add and remove.
  useEffect(() => {
    const missing = selectedProducts.filter(
      (id) => !productDetails[id] && !requestedIds.current.has(id),
    );
    if (missing.length === 0) return;

    missing.forEach((id) => requestedIds.current.add(id));

    Promise.all(
      missing.map((id) =>
        // A product that 404s just stays unresolved; the rest still render.
        apiClient.get<Product>(`/api/admin/products/${id}`).catch(() => null),
      ),
    ).then((results) => {
      const resolved = results.filter((item): item is Product =>
        Boolean(item?._id),
      );
      if (resolved.length === 0) return;
      setProductDetails((current) => ({ ...current, ...indexById(resolved) }));
    });
  }, [selectedProducts, productDetails]);

  // Search products
  const extraQueryKey = JSON.stringify(extraQuery ?? {});
  const searchProducts = useCallback(async (query: string) => {
    if (!query.trim()) {
      setProducts([]);
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      params.set("search", query);
      params.set("limit", "20");
      params.set("status", "active");
      for (const [key, value] of Object.entries(extraQuery ?? {})) {
        params.set(key, value);
      }

      const res = await fetch(`/api/admin/products?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        const list =
          Array.isArray(data?.data?.data) ? data.data.data :
          Array.isArray(data?.data) ? data.data :
          Array.isArray(data) ? data :
          [];
        setProducts(list);
      }
    } catch (error) {
      console.error("Failed to search products:", error);
    } finally {
      setIsSearching(false);
    }
    // Serialized so a caller passing a fresh object each render does not
    // re-create the search (and re-fire the debounce) on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraQueryKey]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchProducts(searchValue);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchValue, searchProducts]);

  const toggleProduct = (product: Product) => {
    if (selectedProducts.includes(product._id)) {
      onChange(selectedProducts.filter((id) => id !== product._id));
      return;
    }
    if (max !== undefined && selectedProducts.length >= max) return;
    // The search row carries everything the selected list renders, so keep it
    // rather than letting the hydration effect fetch it straight back.
    setProductDetails((current) => ({ ...current, [product._id]: product }));
    onChange([...selectedProducts, product._id]);
  };

  const atCapacity =
    max !== undefined && selectedProducts.length >= max;

  const removeProduct = (productId: string) => {
    onChange(selectedProducts.filter((id) => id !== productId));
  };

  const moveProduct = (fromIndex: number, toIndex: number) => {
    const newOrder = [...selectedProducts];
    const [removed] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, removed);
    onChange(newOrder);
  };

  // Order is content for the sections that lay their picks out in fixed
  // slots, so the list is draggable — the grip used to be decoration over
  // hover-only Up/Down buttons nobody could find.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = selectedProducts.indexOf(String(active.id));
    const to = selectedProducts.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(selectedProducts, from, to));
  };

  return (
    <div className="overflow-hidden rounded-[10px] border bg-card">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
          {max !== undefined
            ? `${selectedProducts.length} / ${max}`
            : selectedProducts.length}
        </span>
      </div>
      <div className="space-y-3 p-3">
        {/* Search Products */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products to add..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="h-9 pl-9"
          />
        </div>

        {/* Search Results */}
        {searchValue && (
          <div className="rounded-md border bg-muted/30">
            <div className="max-h-[200px] overflow-y-auto">
              {isSearching ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Searching...
                </div>
              ) : products.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No products found
                </div>
              ) : (
                <div className="space-y-0.5 p-1.5">
                  {products.map((product) => {
                    const isSelected = selectedProducts.includes(product._id);
                    const blocked = atCapacity && !isSelected;
                    return (
                      <div
                        key={product._id}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-2 py-1.5",
                          blocked
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer hover:bg-background",
                          isSelected && "bg-background shadow-xs",
                        )}
                        onClick={() => {
                          if (!blocked) toggleProduct(product);
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          disabled={blocked}
                          className="pointer-events-none"
                        />
                        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                          {product.images?.[0] ? (
                            <AppImage
                              src={product.images[0]}
                              alt={product.title || product.name}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <Package className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {product.title || product.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatPrice(product.price)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Selected Products */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/60">
              Selected
            </span>
            {selectedProducts.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => onChange([])}
              >
                Clear all
              </Button>
            )}
          </div>

          {selectedProducts.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No products selected. Search and add products above.
            </div>
          ) : (
            <DndContext
              id="product-picker"
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={selectedProducts}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y rounded-md border">
                  {selectedProducts.map((productId, index) => (
                    <SortableProductRow
                      key={productId}
                      productId={productId}
                      index={index}
                      total={selectedProducts.length}
                      product={productDetails[productId]}
                      formatPrice={formatPrice}
                      onMove={moveProduct}
                      onRemove={() => removeProduct(productId)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One picked product. The slot number is the point: sections that lay their
 * picks out in fixed places (the deals panel's large card and its four side
 * cards) read this order, so the merchant needs to see it, not infer it.
 */
function SortableProductRow({
  productId,
  index,
  total,
  product,
  formatPrice,
  onMove,
  onRemove,
}: {
  productId: string;
  index: number;
  total: number;
  product?: Product;
  formatPrice: (value: number) => string;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: productId });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2.5 bg-card py-1.5 pl-2 pr-1.5",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${product?.title || product?.name || "product"}`}
        className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
        {index + 1}
      </span>
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {product?.images?.[0] ? (
          <AppImage
            src={product.images[0]}
            alt={product.title || product.name}
            fill
            className="object-cover"
          />
        ) : (
          <Package className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
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
        ) : (
          <div className="text-sm text-muted-foreground">Loading...</div>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {/* Keyboard and touch fallback for the drag handle. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Move up"
          className="text-muted-foreground"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Move down"
          className="text-muted-foreground"
          disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Remove"
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
