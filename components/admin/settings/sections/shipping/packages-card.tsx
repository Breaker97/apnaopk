"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Settings } from "@/components/admin/settings/types";

type PackagePreset = NonNullable<Settings["shipping"]["packages"]>[number];
type TSafe = (key: string, fallback: string) => string;

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The box catalogue a carrier quote is priced against.
 *
 * Carriers charge by volume as well as weight, and products carry no
 * dimensions by default, so without at least one saved box there is nothing to
 * quote. The schema seeds one, which is why this list is never empty on a
 * fresh install.
 */
export function PackagesCard(props: {
  packages: PackagePreset[];
  tSafe: TSafe;
  updateField: (path: string, value: unknown) => void;
}) {
  const { packages, tSafe, updateField } = props;

  const write = (next: PackagePreset[]) =>
    updateField("shipping.packages", next);

  const patch = (index: number, changes: Partial<PackagePreset>) => {
    write(
      packages.map((preset, i) =>
        i === index ? { ...preset, ...changes } : preset,
      ),
    );
  };

  /** Exactly one default, enforced here so the packer never has to choose. */
  const setDefault = (index: number) => {
    write(packages.map((preset, i) => ({ ...preset, isDefault: i === index })));
  };

  const add = () => {
    write([
      ...packages,
      {
        id: newId(),
        name: tSafe("admin.settings.shipping.packages.newName", "New box"),
        length: 30,
        width: 20,
        height: 15,
        dimensionUnit: "cm",
        emptyWeight: 0,
        weightUnit: "kg",
        isDefault: packages.length === 0,
        active: true,
      },
    ]);
  };

  const remove = (index: number) => {
    const next = packages.filter((_, i) => i !== index);
    // Removing the default would leave the packer with no fallback, so the
    // first surviving box inherits the flag.
    if (next.length > 0 && !next.some((preset) => preset.isDefault)) {
      next[0] = { ...next[0], isDefault: true };
    }
    write(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {tSafe("admin.settings.shipping.packages.title", "Saved packages")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {tSafe(
              "admin.settings.shipping.packages.description",
              "Boxes a carrier quote can be priced against. The default is used whenever an order's items have no dimensions of their own.",
            )}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4" />
          {tSafe("admin.settings.shipping.packages.add", "Add package")}
        </Button>
      </div>

      {packages.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {tSafe(
            "admin.settings.shipping.packages.empty",
            "No packages yet. Carrier rates need at least one box.",
          )}
        </p>
      ) : null}

      <div className="space-y-4">
        {packages.map((preset, index) => (
          <div key={preset.id} className="rounded-lg border p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor={`package-name-${preset.id}`}>
                  {tSafe("admin.settings.shipping.packages.name", "Name")}
                </Label>
                <Input
                  id={`package-name-${preset.id}`}
                  value={preset.name}
                  onChange={(e) => patch(index, { name: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch
                  id={`package-active-${preset.id}`}
                  checked={preset.active !== false}
                  onCheckedChange={(checked) => patch(index, { active: checked })}
                />
                <Label htmlFor={`package-active-${preset.id}`} className="text-xs">
                  {tSafe("admin.settings.shipping.packages.active", "Active")}
                </Label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
                aria-label={tSafe(
                  "admin.settings.shipping.packages.remove",
                  "Remove package",
                )}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {(["length", "width", "height"] as const).map((axis) => (
                <div key={axis} className="space-y-2">
                  <Label htmlFor={`package-${axis}-${preset.id}`} className="capitalize">
                    {tSafe(`admin.settings.shipping.packages.${axis}`, axis)}
                  </Label>
                  <NumberInput
                    id={`package-${axis}-${preset.id}`}
                    min={0}
                    value={preset[axis] ?? 0}
                    whenEmpty={0}
                    onValueChange={(next) =>
                      patch(index, { [axis]: next ?? 0 } as Partial<PackagePreset>)
                    }
                  />
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor={`package-unit-${preset.id}`}>
                  {tSafe("admin.settings.shipping.packages.unit", "Unit")}
                </Label>
                <Select
                  value={preset.dimensionUnit || "cm"}
                  onValueChange={(value) =>
                    patch(index, {
                      dimensionUnit: value as PackagePreset["dimensionUnit"],
                    })
                  }
                >
                  <SelectTrigger id={`package-unit-${preset.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cm">cm</SelectItem>
                    <SelectItem value="in">in</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor={`package-tare-${preset.id}`}>
                  {tSafe(
                    "admin.settings.shipping.packages.emptyWeight",
                    "Empty weight",
                  )}
                </Label>
                <NumberInput
                  id={`package-tare-${preset.id}`}
                  min={0}
                  step="0.01"
                  value={preset.emptyWeight ?? 0}
                  whenEmpty={0}
                  onValueChange={(next) => patch(index, { emptyWeight: next ?? 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`package-max-${preset.id}`}>
                  {tSafe("admin.settings.shipping.packages.maxWeight", "Max weight")}
                </Label>
                <NumberInput
                  id={`package-max-${preset.id}`}
                  min={0}
                  step="0.01"
                  value={preset.maxWeight}
                  placeholder={tSafe(
                    "admin.settings.shipping.packages.noLimit",
                    "No limit",
                  )}
                  onValueChange={(next) => patch(index, { maxWeight: next })}
                />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id={`package-default-${preset.id}`}
                  checked={preset.isDefault === true}
                  onCheckedChange={(checked) => {
                    if (checked) setDefault(index);
                  }}
                />
                <Label htmlFor={`package-default-${preset.id}`} className="text-xs">
                  {tSafe("admin.settings.shipping.packages.default", "Default box")}
                </Label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Separator />
    </div>
  );
}
