"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LOCATION_STORAGE_KEY,
  clearLocationCookieString,
  stripDistanceSortForLocation,
  stripPickupFacetForLocation,
  stripLocationParams,
} from "@/lib/locations/shopper-location";

/**
 * Drop the location filter and reload the grid unfiltered.
 *
 * Clears all three places the location lives — URL, localStorage, cookie —
 * because the cookie alone would silently re-apply the filter on the very next
 * navigation, which reads as the "show everywhere" button not working.
 */
function useClearLocation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(() => {
    try {
      window.localStorage.removeItem(LOCATION_STORAGE_KEY);
      document.cookie = clearLocationCookieString();
    } catch {
      // Storage blocked. The URL change below still clears this navigation.
    }

    const params = new URLSearchParams(searchParams.toString());
    stripLocationParams(params);
    stripDistanceSortForLocation(params, null);
    stripPickupFacetForLocation(params, null);
    params.delete("page");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
    router.refresh();
  }, [pathname, router, searchParams]);
}

export function ProductGridClearLocation({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const clearLocation = useClearLocation();

  return (
    <Button
      type="button"
      variant="outline"
      onClick={clearLocation}
      className={className}
    >
      {label}
    </Button>
  );
}

/**
 * Standing reminder that the grid is narrowed to a place.
 *
 * Without it a shopper who set a location days ago reads a short grid as "this
 * store has nothing", with no visible cause — the pill lives up in the header,
 * far from the results it explains.
 */
export function ProductGridLocationNotice({
  locationLabel,
  radiusLabel,
  clearLabel,
  className,
}: {
  locationLabel: string;
  radiusLabel?: string;
  clearLabel: string;
  className?: string;
}) {
  const clearLocation = useClearLocation();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm",
        className,
      )}
    >
      <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium">{locationLabel}</span>
      {radiusLabel ? (
        <span className="text-muted-foreground">· {radiusLabel}</span>
      ) : null}
      <button
        type="button"
        onClick={clearLocation}
        className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3 w-3" aria-hidden="true" />
        {clearLabel}
      </button>
    </div>
  );
}
