"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Package, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeatureGroup } from "@/components/admin/settings/fields/feature-row";
import type { Settings } from "@/components/admin/settings/types";
import {
  DIMENSION_UNITS,
  PARCEL_WEIGHT_UNITS,
} from "@/lib/shipping/carrier-config";
import {
  EditDialogFooter,
  EditDialogHeader,
  FieldLine,
  SwitchRow,
  Unit,
  useDraft,
} from "./dialog-fields";
import { ItemRow } from "./item-row";

type PackagePreset = NonNullable<Settings["shipping"]["packages"]>[number];

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Exactly one default, and one there is whenever there is a box at all:
 * removing or un-defaulting the default would leave the packer with nothing to
 * fall back to, so the first box inherits the flag.
 */
export function withOneDefault(
  packages: PackagePreset[],
  preferredId?: string,
): PackagePreset[] {
  const defaultId =
    preferredId ?? packages.find((preset) => preset.isDefault)?.id ?? packages[0]?.id;
  // Only the boxes whose flag moves are rebuilt: an untouched one keeps its
  // stored shape, so it never counts as an unsaved change.
  return packages.map((preset) => {
    const isDefault = preset.id === defaultId;
    return Boolean(preset.isDefault) === isDefault ? preset : { ...preset, isDefault };
  });
}

/**
 * The box catalogue a carrier quote is priced against, one row per box with
 * its size and an Edit button.
 *
 * Carriers charge by volume as well as weight, and products carry no
 * dimensions by default, so without at least one saved box there is nothing to
 * quote. The schema seeds one, which is why this list is never empty on a
 * fresh install.
 */
export function PackagesSection(props: {
  packages: PackagePreset[];
  /** The store's weight unit: a new box starts in it, and a box's limit is in it. */
  weightUnit: "kg" | "lb";
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping.packages");
  const { packages } = props;
  const [editing, setEditing] = useState<{ preset: PackagePreset; isNew: boolean } | null>(
    null,
  );

  const write = (next: PackagePreset[]) => props.updateField("shipping.packages", next);

  const summary = (preset: PackagePreset) =>
    [
      t("dimensions", {
        length: preset.length ?? 0,
        width: preset.width ?? 0,
        height: preset.height ?? 0,
        unit: preset.dimensionUnit || "cm",
      }),
      Number(preset.emptyWeight) > 0
        ? t("emptyWeightShort", {
            weight: Number(preset.emptyWeight),
            unit: preset.weightUnit || "kg",
          })
        : null,
      Number(preset.maxWeight) > 0
        ? t("maxWeightShort", { weight: Number(preset.maxWeight), unit: props.weightUnit })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const imperial = props.weightUnit === "lb";

  return (
    <FeatureGroup title={t("title")} hint={t("description")}>
      {packages.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">{t("empty")}</p>
      ) : null}

      {packages.map((preset) => (
        <ItemRow
          key={preset.id}
          icon={
            <span
              aria-hidden
              className="bg-muted text-muted-foreground flex h-9 w-9 items-center justify-center rounded-md"
            >
              <Package className="h-4 w-4" />
            </span>
          }
          title={preset.name || t("newName")}
          badges={
            <>
              {preset.isDefault ? (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  {t("defaultBadge")}
                </Badge>
              ) : null}
              {preset.active === false ? (
                <Badge variant="outline" className="text-muted-foreground">
                  {t("off")}
                </Badge>
              ) : null}
            </>
          }
          description={summary(preset)}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("editNamed", { name: preset.name || t("newName") })}
              onClick={() => setEditing({ preset, isNew: false })}
            >
              {t("edit")}
            </Button>
          }
        />
      ))}

      <div className="px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-primary"
          onClick={() =>
            setEditing({
              isNew: true,
              preset: {
                id: newId(),
                name: t("newName"),
                length: imperial ? 12 : 30,
                width: imperial ? 8 : 20,
                height: imperial ? 6 : 15,
                dimensionUnit: imperial ? "in" : "cm",
                emptyWeight: 0,
                weightUnit: props.weightUnit,
                isDefault: packages.length === 0,
                active: true,
              },
            })
          }
        >
          <Plus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>

      {editing ? (
        <PackageDialog
          key={editing.preset.id}
          initial={editing.preset}
          isNew={editing.isNew}
          // The only box is the default whatever its switch says.
          canChangeDefault={!editing.preset.isDefault || editing.isNew}
          storeWeightUnit={props.weightUnit}
          onClose={() => setEditing(null)}
          onDone={(preset) => {
            const next = editing.isNew
              ? [...packages, preset]
              : packages.map((p) => (p.id === preset.id ? preset : p));
            write(withOneDefault(next, preset.isDefault ? preset.id : undefined));
            setEditing(null);
          }}
          onRemove={
            editing.isNew
              ? undefined
              : () => {
                  write(withOneDefault(packages.filter((p) => p.id !== editing.preset.id)));
                  setEditing(null);
                }
          }
        />
      ) : null}
    </FeatureGroup>
  );
}

/** One box, edited on a copy: Done hands it back, Cancel drops it. */
function PackageDialog(props: {
  initial: PackagePreset;
  isNew: boolean;
  canChangeDefault: boolean;
  storeWeightUnit: "kg" | "lb";
  onClose: () => void;
  onDone: (preset: PackagePreset) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("admin.settings.shipping.packages");
  const { draft, set, changed } = useDraft<PackagePreset>(props.initial);

  const size = (axis: "length" | "width" | "height", id?: string) => (
    <NumberInput
      id={id}
      aria-label={t(axis)}
      className="w-20"
      min={0}
      value={draft[axis] ?? 0}
      whenEmpty={0}
      onValueChange={(next) => set({ [axis]: next ?? 0 } as Partial<PackagePreset>)}
    />
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : props.onClose())}>
      {/* A title is all this dialog needs; say so, or Radix warns that a description is missing. */}
      <DialogContent aria-describedby={undefined} className="grid-cols-1 gap-0 p-0 sm:max-w-xl">
        <EditDialogHeader>
          <DialogTitle>{props.isNew ? t("dialogTitleNew") : t("dialogTitleEdit")}</DialogTitle>
        </EditDialogHeader>

        <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <label htmlFor="package-name" className="text-sm font-medium">
              {t("name")}
            </label>
            <Input
              id="package-name"
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>

          <FieldLine compact label={t("size")} htmlFor="package-length">
            {size("length", "package-length")}
            <Unit>×</Unit>
            {size("width")}
            <Unit>×</Unit>
            {size("height")}
            <Select
              value={draft.dimensionUnit || "cm"}
              onValueChange={(value) =>
                set({ dimensionUnit: value as PackagePreset["dimensionUnit"] })
              }
            >
              <SelectTrigger aria-label={t("unit")} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIMENSION_UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLine>

          <FieldLine compact label={t("emptyWeight")} htmlFor="package-tare">
            <NumberInput
              id="package-tare"
              className="w-24"
              min={0}
              step="0.01"
              value={draft.emptyWeight ?? 0}
              whenEmpty={0}
              onValueChange={(next) => set({ emptyWeight: next ?? 0 })}
            />
            <Select
              value={draft.weightUnit || "kg"}
              onValueChange={(value) =>
                set({ weightUnit: value as PackagePreset["weightUnit"] })
              }
            >
              <SelectTrigger aria-label={t("weightUnit")} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARCEL_WEIGHT_UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLine>

          <div className="space-y-1.5">
            <FieldLine compact label={t("maxWeight")} htmlFor="package-max">
              <NumberInput
                id="package-max"
                className="w-28"
                min={0}
                step="0.01"
                value={draft.maxWeight}
                placeholder={t("noLimit")}
                onValueChange={(next) => set({ maxWeight: next })}
              />
              <Unit>{props.storeWeightUnit}</Unit>
            </FieldLine>
            <p className="text-muted-foreground text-xs">{t("maxWeightHint")}</p>
          </div>

          <SwitchRow
            title={t("default")}
            hint={t("defaultHint")}
            checked={draft.isDefault === true}
            disabled={!props.canChangeDefault}
            onCheckedChange={(checked) => set({ isDefault: checked })}
          />
          <SwitchRow
            title={t("active")}
            hint={t("activeHint")}
            checked={draft.active !== false}
            onCheckedChange={(checked) => set({ active: checked })}
          />
        </div>

        <EditDialogFooter
          removeLabel={t("remove")}
          onRemove={props.onRemove}
          onCancel={props.onClose}
          onDone={() => (changed || props.isNew ? props.onDone(draft) : props.onClose())}
        />
      </DialogContent>
    </Dialog>
  );
}
