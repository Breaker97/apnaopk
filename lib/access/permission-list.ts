import {
  GRANTABLE_STAFF_PERMISSIONS,
  STAFF_PERMISSION_PRESETS,
  VENDOR_STAFF_PERMISSIONS,
  resolveRetiredStaffPermissions,
  type StaffPermission,
  type StaffPermissionPreset,
} from "@/config/permissions.config";
import {
  TEAM_PERMISSION_GROUPS,
  type PermissionAction,
  type PermissionGroup,
  type PermissionRisk,
  type PermissionRow,
} from "@/config/team-permission-groups";
import { isStaffTierPermission, type TeamRoleTier } from "@/config/team-permissions.config";

/**
 * How the permission list behaves (config/team-permission-groups.ts): which
 * boxes a member can be given, which are ticked, what a tick changes, and
 * what differs from their role. Pure, so the screens and the tests share it.
 */

/** Who is being given permissions: the store's own team, or a vendor's own staff. */
export type PermissionArea = "admin" | "vendor";

export interface ListedRow {
  row: PermissionRow;
  /** The row's actions this member can be given. */
  actions: PermissionAction[];
  /** The line under the row's name, for this area. */
  hint?: string;
}

export interface ListedGroup {
  group: PermissionGroup;
  rows: ListedRow[];
}

function offered(permission: string, tier: TeamRoleTier, area: PermissionArea): boolean {
  if (tier === "staff" && !isStaffTierPermission(permission)) return false;
  if (area === "vendor" && !VENDOR_STAFF_PERMISSIONS.includes(permission as StaffPermission)) return false;
  return true;
}

/** The groups and rows a member of this tier can be given; empty rows and groups are left out. */
export function permissionGroupsFor(tier: TeamRoleTier, area: PermissionArea = "admin"): ListedGroup[] {
  return TEAM_PERMISSION_GROUPS.map((group) => ({
    group,
    rows: group.rows
      .map((row) => {
        const actions = row.actions.filter((action) => offered(action.permission, tier, area));
        const hintOffered = !row.hintAbout || actions.some((action) => action.permission === row.hintAbout);
        return {
          row,
          actions,
          hint: (area === "vendor" ? row.vendorHint : undefined) ?? (hintOffered ? row.hint : undefined),
        };
      })
      .filter((listed) => listed.actions.length > 0),
  })).filter((listed) => listed.rows.length > 0);
}

/** Areas a staff-area member can never be given: they live in the admin dashboard only. */
export function adminDashboardOnlyRows(): PermissionRow[] {
  return TEAM_PERMISSION_GROUPS.flatMap((group) => group.rows).filter((row) =>
    row.actions.every((action) => !isStaffTierPermission(action.permission)),
  );
}

/** Whether a box is ticked: its own string, or the row's pre-split umbrella for anything but View. */
export function isActionHeld(held: ReadonlySet<string>, row: PermissionRow, action: PermissionAction): boolean {
  if (held.has(action.permission)) return true;
  return Boolean(!action.view && row.legacy && held.has(row.legacy));
}

/** The umbrella grant split into the boxes it stands for, so changing one box leaves the others. */
function splitLegacy(next: Set<string>, row: PermissionRow) {
  if (!row.legacy || !next.has(row.legacy)) return;
  next.delete(row.legacy);
  for (const action of row.actions) {
    if (!action.view) next.add(action.permission);
  }
}

/**
 * Tick or untick one box. Ticking an action ticks the row's View; unticking
 * View unticks the row (a standalone action stays either way).
 */
export function toggleAction(
  permissions: readonly string[],
  listed: ListedRow,
  action: PermissionAction,
  on: boolean,
): string[] {
  const next = new Set(permissions);
  splitLegacy(next, listed.row);
  const view = listed.actions.find((candidate) => candidate.view);
  if (on) {
    next.add(action.permission);
    if (view && !action.view && !action.standalone) next.add(view.permission);
  } else {
    next.delete(action.permission);
    if (action.view) {
      for (const other of listed.actions) {
        if (!other.standalone) next.delete(other.permission);
      }
    }
  }
  return Array.from(next);
}

/** Tick or untick every box in some rows (a group's All and None). */
export function setRows(permissions: readonly string[], rows: readonly ListedRow[], on: boolean): string[] {
  const next = new Set(permissions);
  for (const listed of rows) {
    splitLegacy(next, listed.row);
    for (const action of listed.actions) {
      if (on) next.add(action.permission);
      else next.delete(action.permission);
    }
  }
  return Array.from(next);
}

export interface ActionChange {
  row: PermissionRow;
  action: PermissionAction;
  /** Ticked for this member though the role leaves it off (or the reverse). */
  on: boolean;
}

/** The boxes where a member differs from their role. */
export function actionChanges(
  effective: ReadonlySet<string>,
  base: ReadonlySet<string>,
  groups: readonly ListedGroup[],
): ActionChange[] {
  const changes: ActionChange[] = [];
  for (const { rows } of groups) {
    for (const { row, actions } of rows) {
      for (const action of actions) {
        const on = isActionHeld(effective, row, action);
        if (on !== isActionHeld(base, row, action)) changes.push({ row, action, on });
      }
    }
  }
  return changes;
}

export interface AccessSummary {
  held: number;
  total: number;
  /** Each row with something ticked, and what. */
  can: { row: PermissionRow; actions: PermissionAction[] }[];
  /** Rows with nothing ticked. */
  none: PermissionRow[];
  /** Ticked boxes that move money, change the books, hold secrets or give access. */
  watch: { row: PermissionRow; action: PermissionAction; risk: PermissionRisk }[];
}

/** What a member can and can't do, as the summary column says it. */
export function summarizeAccess(held: ReadonlySet<string>, groups: readonly ListedGroup[]): AccessSummary {
  const summary: AccessSummary = { held: 0, total: 0, can: [], none: [], watch: [] };
  for (const { rows } of groups) {
    for (const { row, actions } of rows) {
      const ticked = actions.filter((action) => isActionHeld(held, row, action));
      summary.total += actions.length;
      summary.held += ticked.length;
      if (ticked.length) summary.can.push({ row, actions: ticked });
      else summary.none.push(row);
      for (const action of ticked) {
        if (action.risk) summary.watch.push({ row, action, risk: action.risk });
      }
    }
  }
  return summary;
}

/**
 * A stored staff list as the boxes read it: retired strings mapped to what
 * they stand for. The pre-split umbrellas stay; `isActionHeld` reads them.
 */
export function readStaffPermissions(input: readonly unknown[] | null | undefined): StaffPermission[] {
  const strings = (input ?? []).filter((permission): permission is string => typeof permission === "string");
  return resolveRetiredStaffPermissions(strings).filter(isStaffTierPermission) as StaffPermission[];
}

/** A preset's boxes, cut down to what this area may give. */
export function presetPermissions(preset: StaffPermissionPreset, area: PermissionArea): StaffPermission[] {
  return area === "vendor"
    ? preset.permissions.filter((permission) => VENDOR_STAFF_PERMISSIONS.includes(permission))
    : [...preset.permissions];
}

/** Which preset a list matches exactly (over the boxes this area offers), if any. */
export function matchStaffPreset(
  permissions: readonly string[],
  area: PermissionArea = "admin",
): StaffPermissionPreset | null {
  const groups = permissionGroupsFor("staff", area);
  const ticked = (list: readonly string[]) => {
    const held = new Set(list);
    const out = new Set<string>();
    for (const { rows } of groups) {
      for (const { row, actions } of rows) {
        for (const action of actions) {
          if (isActionHeld(held, row, action)) out.add(action.permission);
        }
      }
    }
    return out;
  };
  const current = ticked(permissions);
  return (
    STAFF_PERMISSION_PRESETS.find((preset) => {
      const target = ticked(presetPermissions(preset, area));
      return target.size === current.size && Array.from(target).every((permission) => current.has(permission));
    }) ?? null
  );
}

/** How many boxes a staff member of this area can be given (the "of N"). */
export function grantableStaffCount(area: PermissionArea): number {
  return area === "vendor"
    ? GRANTABLE_STAFF_PERMISSIONS.filter((permission) => VENDOR_STAFF_PERMISSIONS.includes(permission)).length
    : GRANTABLE_STAFF_PERMISSIONS.length;
}
