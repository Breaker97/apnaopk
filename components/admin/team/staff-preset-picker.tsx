"use client";

import { cn } from "@/lib/utils";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import { STAFF_PERMISSION_PRESETS, type StaffPermission } from "@/config/permissions.config";
import { matchStaffPreset, presetPermissions, type PermissionArea } from "@/lib/access/permission-list";

interface StaffPresetPickerProps {
  area?: PermissionArea;
  permissions: readonly string[];
  onApply: (next: StaffPermission[]) => void;
  disabled?: boolean;
}

/**
 * "Start from": a common staff job's permissions in one click. Only ticks
 * boxes; the list below is the answer. Used when making a staff role and on a
 * vendor's own staff, who have no roles.
 */
export function StaffPresetPicker({ area = "admin", permissions, onApply, disabled = false }: StaffPresetPickerProps) {
  const tr = useAdminPhrase();
  const active = matchStaffPreset(permissions, area);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{tr("Start from", "যেখান থেকে শুরু")}</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {STAFF_PERMISSION_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            disabled={disabled}
            aria-pressed={active?.key === preset.key}
            onClick={() => onApply(presetPermissions(preset, area))}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent/50",
              "disabled:cursor-not-allowed disabled:opacity-60",
              active?.key === preset.key && "border-primary bg-primary/5",
            )}
          >
            <p className="text-sm font-medium">{tr(preset.label)}</p>
            <p className="text-xs text-muted-foreground">{tr(preset.description)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
