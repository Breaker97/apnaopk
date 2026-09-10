"use client";

import { useMemo } from "react";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { StaffPermission } from "@/config/permissions.config";
import {
  GRANTABLE_STAFF_PERMISSIONS,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  STAFF_ROLE_PRESETS,
  hasResourceAction,
  hasResourceView,
  matchStaffRolePreset,
  normalizeStaffPermissions,
  toggleResourceAction,
  toggleResourceView,
} from "../staff-permissions";

interface PermissionsTabProps {
  permissions: StaffPermission[];
  onChange: (next: StaffPermission[]) => void;
  readOnly?: boolean;
}

export function PermissionsTab({
  permissions,
  onChange,
  readOnly = false,
}: PermissionsTabProps) {
  const activePreset = useMemo(
    () => matchStaffRolePreset(permissions),
    [permissions],
  );

  const granted = useMemo(
    () =>
      new Set(
        normalizeStaffPermissions(permissions).filter((permission) =>
          GRANTABLE_STAFF_PERMISSIONS.includes(permission),
        ),
      ),
    [permissions],
  );

  const total = GRANTABLE_STAFF_PERMISSIONS.length;
  const selected = granted.size;
  const percent = total === 0 ? 0 : Math.round((selected / total) * 100);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Start from a role</CardTitle>
            <CardDescription>
              Applies a permission set — fine-tune anything below afterwards
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STAFF_ROLE_PRESETS.map((preset) => {
                const isActive = activePreset?.key === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => onChange([...preset.permissions])}
                    disabled={readOnly}
                    aria-pressed={isActive}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      "hover:border-primary hover:bg-accent/50",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      isActive && "border-primary bg-primary/5",
                    )}
                  >
                    <p className="text-sm font-medium">{preset.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {activePreset
                ? `Matches the ${activePreset.label} preset.`
                : "Custom selection — no preset matches exactly."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Permissions
                </CardTitle>
                <CardDescription>
                  Control what this staff member can access
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={readOnly}
                  onClick={() => onChange([...GRANTABLE_STAFF_PERMISSIONS])}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={readOnly}
                  onClick={() => onChange([])}
                >
                  Clear all
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border">
              <div className="border-b bg-muted/50 px-4 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Each column is independent. You can allow only create, only
                  edit, only delete, or any combination per resource.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-background">
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                        Resource
                      </th>
                      <th className="px-2 py-3 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                        View
                      </th>
                      {PERMISSION_ACTIONS.map((action) => (
                        <th
                          key={action.key}
                          className="px-2 py-3 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase"
                        >
                          {action.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_RESOURCES.map((resource, index) => (
                      <tr
                        key={resource.key}
                        className={cn(
                          "border-b last:border-b-0",
                          index % 2 === 0 ? "bg-background" : "bg-muted/20",
                        )}
                      >
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium">
                            {resource.label}
                          </p>
                          {resource.hint ? (
                            <p className="text-xs text-muted-foreground">
                              {resource.hint}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-2 py-3 text-center">
                          <Checkbox
                            className="mx-auto"
                            checked={hasResourceView(permissions, resource)}
                            disabled={readOnly || !resource.view}
                            onCheckedChange={(checked) =>
                              onChange(
                                toggleResourceView(
                                  permissions,
                                  resource,
                                  Boolean(checked),
                                ),
                              )
                            }
                          />
                        </td>
                        {PERMISSION_ACTIONS.map((action) => (
                          <td
                            key={action.key}
                            className="px-2 py-3 text-center"
                          >
                            <Checkbox
                              className="mx-auto"
                              checked={hasResourceAction(
                                permissions,
                                resource,
                                action.key,
                              )}
                              disabled={readOnly || !resource[action.key]}
                              onCheckedChange={(checked) =>
                                onChange(
                                  toggleResourceAction(
                                    permissions,
                                    resource,
                                    action.key,
                                    Boolean(checked),
                                  ),
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
            <CardDescription>What this staff member can reach</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {selected}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                of {total}
              </span>
            </p>
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Permissions granted"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>

            {/* Grouped by resource rather than one flat wall of chips: the
                question a manager asks is "what can they do to orders?", not
                "is edit_orders in the list?". */}
            <div className="mt-4">
              {PERMISSION_RESOURCES.map((resource) => {
                const viewOn = hasResourceView(permissions, resource);
                const actions = PERMISSION_ACTIONS.filter(
                  (action) => resource[action.key],
                );
                const anyOn =
                  viewOn ||
                  actions.some((action) =>
                    hasResourceAction(permissions, resource, action.key),
                  );

                return (
                  <div
                    key={resource.key}
                    className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
                  >
                    <span
                      className={cn(
                        "text-sm",
                        !anyOn && "text-muted-foreground",
                      )}
                    >
                      {resource.label}
                    </span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {anyOn ? (
                        <>
                          {resource.view ? (
                            <ChipTag label="View" on={viewOn} />
                          ) : null}
                          {actions.map((action) => (
                            <ChipTag
                              key={action.key}
                              label={action.label}
                              on={hasResourceAction(
                                permissions,
                                resource,
                                action.key,
                              )}
                            />
                          ))}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No access
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChipTag({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        on
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground/60 line-through",
      )}
    >
      {label}
    </span>
  );
}
