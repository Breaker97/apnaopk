"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import type { LocationInventory } from "@/types";

interface InventoryLocation {
  _id: string;
  name: string;
  address?: string;
  isDefault?: boolean;
}

interface LocationInventoryManagerProps {
  value: LocationInventory[];
  onChange: (value: LocationInventory[]) => void;
  disabled?: boolean;
  /**
   * Locations the parent already holds — the product form gets them with its
   * form options, so passing them here avoids a second request. Omit it and
   * the component loads the list itself.
   */
  locations?: InventoryLocation[];
  /**
   * Called after a location is created inline. A parent that owns `locations`
   * must add it to its own list, or the quantity entered against it is dropped
   * by any save path that filters inventory down to the known locations.
   */
  onLocationCreated?: (location: InventoryLocation) => void;
  /**
   * Whether to offer the inline "add location" box. The API refuses the create
   * for a caller pinned to specific locations, and rendering it anyway meant
   * the button simply did nothing — the failure only ever reached the console.
   */
  canCreate?: boolean;
}

export function LocationInventoryManager({
  value,
  onChange,
  disabled = false,
  locations: providedLocations,
  onLocationCreated,
  canCreate = true,
}: LocationInventoryManagerProps) {
  const t = useTranslations();
  const [fetchedLocations, setFetchedLocations] = useState<InventoryLocation[]>(
    []
  );
  const [createdLocations, setCreatedLocations] = useState<InventoryLocation[]>(
    []
  );
  const [isFetching, setIsFetching] = useState(true);
  // Derived rather than stored: a caller that supplies `locations` only on a
  // later render would otherwise leave a stored flag stuck at true, because the
  // effect's cleanup skips the `finally` that clears it.
  const isLoading = !providedLocations && isFetching;
  const [newLocationName, setNewLocationName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const baseLocations = providedLocations ?? fetchedLocations;

  // Locations created inline stay local until whoever owns `baseLocations`
  // refreshes, so they are appended and de-duped instead of replacing the list.
  const locations = useMemo(() => {
    const known = new Set(baseLocations.map((l) => String(l._id)));
    return [
      ...baseLocations,
      ...createdLocations.filter((l) => !known.has(String(l._id))),
    ];
  }, [baseLocations, createdLocations]);

  useEffect(() => {
    if (providedLocations) return;

    let cancelled = false;
    async function fetchLocations() {
      try {
        const data =
          await apiClient.get<InventoryLocation[]>("/api/admin/locations");
        if (!cancelled) setFetchedLocations(data || []);
      } catch (error) {
        console.error("Failed to fetch locations:", error);
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    }
    fetchLocations();

    return () => {
      cancelled = true;
    };
  }, [providedLocations]);

  // No seeding here, deliberately.
  //
  // This used to add a `quantity: 0` row for every location the product did not
  // already track. Two things were wrong with that. It raced the owning form,
  // which seeds the same rows and knows something this component does not —
  // whether the product still holds untracked units in `stock`. And whichever
  // ran first, the zeros won: once `locationInventory` has a row, Σ(rows)
  // becomes `stock`, so a product with 100 untracked units saved as 0.
  //
  // A location with no row is simply not stocked here, which is both the honest
  // reading and the safe one. Rows appear when a merchant types a quantity
  // (`handleQuantityChange`) or creates a location inline, where zero really is
  // the opening balance.

  const handleQuantityChange = (locationId: string, quantity: number) => {
    const updated = value.map((item) =>
      String(item.locationId) === locationId
        ? { ...item, quantity: Math.max(0, quantity) }
        : item
    );

    // If location doesn't exist in value, add it
    if (!updated.some((item) => String(item.locationId) === locationId)) {
      const loc = locations.find((l) => l._id === locationId);
      if (loc) {
        updated.push({
          locationId,
          locationName: loc.name,
          quantity: Math.max(0, quantity),
        });
      }
    }

    onChange(updated);
  };

  const handleCreateLocation = async () => {
    if (!newLocationName.trim()) return;

    setIsCreating(true);
    try {
      const created = await apiClient.post<InventoryLocation>(
        "/api/admin/locations",
        { name: newLocationName.trim() }
      );

      if (created?._id) {
        setCreatedLocations((prev) => [...prev, created]);
        onLocationCreated?.(created);
        // A branch that did not exist a second ago genuinely holds nothing, so
        // zero is the right opening balance here — unlike the blanket seeding
        // this component used to do for locations that predate the product.
        onChange([
          ...value,
          {
            locationId: created._id,
            locationName: created.name,
            quantity: 0,
          },
        ]);
        setNewLocationName("");
      }
    } catch (error) {
      console.error("Failed to create location:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const getQuantityForLocation = (locationId: string): number => {
    const item = value.find((v) => String(v.locationId) === locationId);
    return item?.quantity ?? 0;
  };

  const totalQuantity = value.reduce(
    (sum, item) => sum + (item.quantity || 0),
    0
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">
            {t("admin.productForm.inventoryByLocation")}
          </span>
        </div>
        <Badge variant="secondary">
          {t("admin.productForm.totalQuantity", {
            total: totalQuantity,
          })}
        </Badge>
      </div>

      {locations.length === 0 ? (
        <div className="text-sm text-muted-foreground p-4 border rounded-lg text-center">
          {t("admin.productForm.noLocations")}
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((location) => (
            <div
              key={location._id}
              className="flex items-center justify-between gap-4 p-3 border rounded-lg"
            >
              <div className="flex-1">
                <div className="text-sm font-medium flex items-center gap-2">
                  {location.name}
                  {location.isDefault && (
                    <Badge variant="outline" className="text-xs">
                      {t("admin.productForm.defaultLocation")}
                    </Badge>
                  )}
                </div>
                {location.address && (
                  <p className="text-xs text-muted-foreground">
                    {location.address}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("admin.productForm.qty")}
                </span>
                <NumberInput
                  min={0}
                  step={1}
                  value={getQuantityForLocation(location._id)}
                  whenEmpty={0}
                  normalize={Math.trunc}
                  onValueChange={(next) =>
                    handleQuantityChange(location._id, next ?? 0)
                  }
                  disabled={disabled}
                  className="w-24"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new location inline */}
      {canCreate ? (
        <div className="flex gap-2 pt-2 border-t">
          <Input
            placeholder={t("admin.productForm.placeholders.newLocation")}
            value={newLocationName}
            onChange={(e) => setNewLocationName(e.target.value)}
            disabled={disabled || isCreating}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateLocation();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleCreateLocation}
            disabled={disabled || isCreating || !newLocationName.trim()}
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
