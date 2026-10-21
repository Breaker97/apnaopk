"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StaffPermission } from "@/config/permissions.config";
import { PermissionList } from "@/components/admin/team/permission-list";
import { StaffPresetPicker } from "@/components/admin/team/staff-preset-picker";
import { AccessSummaryCard } from "@/components/admin/team/access-summary-card";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import type { StaffArea } from "../staff-detail-types";

interface PermissionsTabProps {
  permissions: StaffPermission[];
  onChange: (next: StaffPermission[]) => void;
  readOnly?: boolean;
  /** The vendor area offers only what a vendor may grant its own staff. */
  area?: StaffArea;
  /** The member's name, for the summary. */
  name?: string;
  /** Whether the seller may give a permission (its plan); absent: every box. */
  canGrant?: (permission: string) => boolean;
}

/**
 * A staff member's own permission list, for a vendor's staff: vendors give
 * permissions one by one, with no roles. The store's own team gets a role
 * instead (components/admin/team/team-member-role-card.tsx).
 */
export function PermissionsTab({
  permissions,
  onChange,
  readOnly = false,
  area = "vendor",
  name = "",
  canGrant,
}: PermissionsTabProps) {
  const tr = useAdminPhrase();
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{tr("Permissions", "পারমিশন")}</CardTitle>
          <CardDescription>
            {tr("What this staff member can do, by area.", "এই স্টাফ সদস্য কী করতে পারবে, এরিয়া অনুযায়ী।")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {readOnly ? null : (
            <StaffPresetPicker
              area={area}
              permissions={permissions}
              // A preset gives only what the seller may give.
              onApply={(next) => onChange(canGrant ? next.filter((permission) => permissions.includes(permission) || canGrant(permission)) : next)}
            />
          )}
          <PermissionList
            tier="staff"
            area={area}
            permissions={permissions}
            readOnly={readOnly}
            onChange={(next) => onChange(next as StaffPermission[])}
            canGrant={canGrant}
          />
        </CardContent>
      </Card>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <AccessSummaryCard name={name} tier="staff" area={area} permissions={permissions} />
      </div>
    </div>
  );
}
