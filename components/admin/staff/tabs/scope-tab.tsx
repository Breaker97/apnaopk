"use client";

import { useMemo, useState } from "react";
import { MapPin, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { StaffFormValues, StaffScopeOption } from "../staff-detail-types";

interface ScopeTabProps {
  form: StaffFormValues;
  setField: <K extends keyof StaffFormValues>(
    key: K,
    value: StaffFormValues[K],
  ) => void;
  vendors: StaffScopeOption[];
  locations: StaffScopeOption[];
  optionsLoading?: boolean;
  readOnly?: boolean;
}

export function ScopeTab({
  form,
  setField,
  vendors,
  locations,
  optionsLoading = false,
  readOnly = false,
}: ScopeTabProps) {
  const [vendorQuery, setVendorQuery] = useState("");

  const visibleVendors = useMemo(() => {
    const query = vendorQuery.trim().toLowerCase();
    if (!query) return vendors;
    return vendors.filter((vendor) =>
      vendor.name.toLowerCase().includes(query),
    );
  }, [vendorQuery, vendors]);

  const regionCount = form.fulfillmentRegions
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean).length;

  const toggle = (
    key: "vendorIds" | "locationIds",
    value: string,
    checked: boolean,
  ) => {
    const next = new Set(form[key]);
    if (checked) next.add(value);
    else next.delete(value);
    setField(key, Array.from(next));
  };

  const unscoped =
    form.vendorIds.length === 0 &&
    form.locationIds.length === 0 &&
    regionCount === 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Locations
            </CardTitle>
            <CardDescription>
              Which stores this person can operate. Empty means every location.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {optionsLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading locations…
              </p>
            ) : locations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No inventory locations yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {locations.map((location) => (
                  <label
                    key={location._id}
                    className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={form.locationIds.includes(location._id)}
                      disabled={readOnly}
                      onCheckedChange={(checked) =>
                        toggle("locationIds", location._id, Boolean(checked))
                      }
                    />
                    <span className="truncate">{location.name}</span>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Vendors
            </CardTitle>
            <CardDescription>
              Empty means the staff member sees every vendor&apos;s data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {vendors.length > 8 && (
              <Input
                value={vendorQuery}
                onChange={(e) => setVendorQuery(e.target.value)}
                placeholder="Search vendors…"
              />
            )}
            {optionsLoading ? (
              <p className="text-sm text-muted-foreground">Loading vendors…</p>
            ) : visibleVendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {vendors.length === 0
                  ? "No vendors yet."
                  : "No vendor matches that search."}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleVendors.map((vendor) => (
                  <label
                    key={vendor._id}
                    className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={form.vendorIds.includes(vendor._id)}
                      disabled={readOnly}
                      onCheckedChange={(checked) =>
                        toggle("vendorIds", vendor._id, Boolean(checked))
                      }
                    />
                    <span className="truncate">{vendor.name}</span>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fulfillment regions</CardTitle>
            <CardDescription>One region per line</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="staff-regions" className="sr-only">
                Fulfillment regions
              </Label>
              <Textarea
                id="staff-regions"
                value={form.fulfillmentRegions}
                onChange={(e) => setField("fulfillmentRegions", e.target.value)}
                placeholder={"US\nCalifornia\nBangladesh"}
                rows={3}
                disabled={readOnly}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Effective scope</CardTitle>
            <CardDescription>
              What the staff dashboard will show
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center justify-between gap-3 border-b py-2">
              <span className="text-muted-foreground">Locations</span>
              <Badge variant={form.locationIds.length ? "default" : "outline"}>
                {form.locationIds.length
                  ? `${form.locationIds.length} of ${locations.length}`
                  : "All"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3 border-b py-2">
              <span className="text-muted-foreground">Vendors</span>
              <Badge variant={form.vendorIds.length ? "default" : "outline"}>
                {form.vendorIds.length
                  ? `${form.vendorIds.length} of ${vendors.length}`
                  : "All"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-muted-foreground">Regions</span>
              <Badge variant={regionCount ? "default" : "outline"}>
                {regionCount || "All"}
              </Badge>
            </div>

            <p className="mt-3 rounded-lg border-l-2 border-primary bg-muted/50 p-3 text-xs text-muted-foreground">
              {unscoped
                ? "No scope set — this staff member can reach the whole store."
                : "Each dimension narrows the last: a vendor plus a location means orders that match both."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
