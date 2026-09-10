/**
 * Client-side mirror of `resolveVendorAccess`, so the Access tab can show the
 * effect of an unsaved override edit without a round trip.
 *
 * Deliberately NOT a second implementation of the rules: the server sends the
 * resolved policy and entitlement per pack, and this only re-applies the
 * override layer on top of them. That keeps the one thing an admin edits live
 * while leaving the layers they cannot edit to the server that owns them —
 * which is what stopped the old grid from lying about effective access.
 */

import {
  VENDOR_PERMISSION_PACKS,
  cascadeVendorRevokes,
  type VendorPermission,
  type VendorPermissionPack,
} from "@/config/permissions.config";

type OverrideMode = "grant" | "revoke";

export interface VendorOverrideDraft {
  permission: VendorPermission;
  mode: OverrideMode;
  reason?: string;
  grantedBy?: string;
  grantedAt?: string;
  expiresAt?: string | null;
}

/** What the server resolved for the layers the admin cannot edit here. */
export interface PackLayerSnapshot {
  pack: VendorPermissionPack;
  label: string;
  /** Whether the marketplace allows this pack at all. One switch, one pack. */
  policy: boolean;
  entitled: boolean;
  /**
   * Whether the account's lifecycle state permits the pack — false only during
   * an unpaid setup window. Absent on an older payload, which reads as allowed
   * so the tab keeps working against a server that has not shipped it yet.
   */
  lifecycle?: boolean;
}

type PermissionVerdict =
  | "allowed"
  | "override"
  | "policy"
  | "plan"
  | "revoked"
  | "lifecycle";

export type PackVerdict = PermissionVerdict | "partial";

interface PermissionRow {
  permission: VendorPermission;
  verdict: PermissionVerdict;
  override?: VendorOverrideDraft;
  allowed: boolean;
}

export interface PackRow extends PackLayerSnapshot {
  permissions: PermissionRow[];
  allowedCount: number;
  total: number;
  verdict: PackVerdict;
  /** How many permissions in this pack carry an override right now. */
  overriddenCount: number;
}

/**
 * Same ordering as the server: policy, then entitlement, then the override.
 * The outermost layer that says no is the one reported, because that is the one
 * that has to be fixed first.
 */
function verdictFor(
  permission: VendorPermission,
  snapshot: PackLayerSnapshot,
  override: VendorOverrideDraft | undefined,
  revoked: Set<VendorPermission>,
): PermissionVerdict {
  if (!snapshot.policy) return "policy";
  const granted = override?.mode === "grant";
  if (!snapshot.entitled && !granted) return "plan";
  // `revoked` is the CASCADED set, not just the explicit ones: revoking a verb
  // has to take the umbrella that would otherwise satisfy it, or the revoke is
  // decorative. Same function the server uses, so the two cannot drift.
  if (revoked.has(permission)) return "revoked";
  // Last, exactly as the server orders it: an override can be perfectly valid
  // and still not apply yet because the account has not finished paying.
  if (snapshot.lifecycle === false) return "lifecycle";
  return snapshot.entitled ? "allowed" : "override";
}

export function buildPackRows(
  snapshots: PackLayerSnapshot[],
  overrides: VendorOverrideDraft[],
): PackRow[] {
  const byPermission = new Map<VendorPermission, VendorOverrideDraft>(
    overrides.map((override) => [override.permission, override]),
  );
  const revoked = cascadeVendorRevokes(
    overrides
      .filter((override) => override.mode === "revoke")
      .map((override) => override.permission),
  );

  return snapshots.map((snapshot) => {
    const permissions = VENDOR_PERMISSION_PACKS[snapshot.pack].map(
      (permission) => {
        const override = byPermission.get(permission);
        const verdict = verdictFor(permission, snapshot, override, revoked);
        return {
          permission,
          verdict,
          override,
          allowed: verdict === "allowed" || verdict === "override",
        } satisfies PermissionRow;
      },
    );

    const total = permissions.length;
    const allowedCount = permissions.filter((row) => row.allowed).length;
    const overriddenCount = permissions.filter((row) => row.override).length;

    let verdict: PackVerdict;
    if (allowedCount === total) {
      verdict = permissions.some((row) => row.verdict === "override")
        ? "override"
        : "allowed";
    } else if (allowedCount === 0) {
      verdict =
        (
          ["policy", "plan", "revoked", "lifecycle"] as PermissionVerdict[]
        ).find((candidate) =>
          permissions.some((row) => row.verdict === candidate),
        ) ?? "plan";
    } else {
      verdict = "partial";
    }

    return {
      ...snapshot,
      permissions,
      allowedCount,
      total,
      overriddenCount,
      verdict,
    };
  });
}

/** none → grant → revoke → none, for one permission. */
export function cyclePermissionOverride(
  overrides: VendorOverrideDraft[],
  permission: VendorPermission,
): VendorOverrideDraft[] {
  const current = overrides.find((item) => item.permission === permission);
  const rest = overrides.filter((item) => item.permission !== permission);
  if (!current) return [...rest, { permission, mode: "grant" }];
  if (current.mode === "grant") {
    return [...rest, { ...current, mode: "revoke" }];
  }
  return rest;
}

/**
 * Bulk action on a pack: none → grant all → revoke all → clear.
 * A pack with a MIXED set normalises to grant-all, which is the least
 * surprising thing a single click can mean.
 */
export function cyclePackOverride(
  overrides: VendorOverrideDraft[],
  pack: VendorPermissionPack,
): VendorOverrideDraft[] {
  const members = VENDOR_PERMISSION_PACKS[pack] as readonly VendorPermission[];
  const memberSet = new Set<VendorPermission>(members);
  const rest = overrides.filter((item) => !memberSet.has(item.permission));
  const mine = overrides.filter((item) => memberSet.has(item.permission));

  const allGrant =
    mine.length === members.length && mine.every((item) => item.mode === "grant");
  const allRevoke =
    mine.length === members.length &&
    mine.every((item) => item.mode === "revoke");

  if (allGrant) {
    return [
      ...rest,
      ...members.map((permission) => ({ permission, mode: "revoke" as const })),
    ];
  }
  if (allRevoke) return rest;
  return [
    ...rest,
    ...members.map((permission) => ({ permission, mode: "grant" as const })),
  ];
}

/**
 * Edit the note or the expiry on one override without touching its mode.
 *
 * Both belong to the override rather than to the click that created it, and
 * both are what makes it auditable later: `reason` answers "why", `expiresAt`
 * answers "until when" — which is most of what a support request actually asks
 * for, since a window that closes by itself needs no follow-up from anyone.
 */
export function editOverrideDetail(
  overrides: VendorOverrideDraft[],
  permission: VendorPermission,
  patch: { reason?: string; expiresAt?: string | null },
): VendorOverrideDraft[] {
  return overrides.map((item) =>
    item.permission === permission ? { ...item, ...patch } : item,
  );
}

/**
 * What the pack's Override button says, as a translation key plus the count it
 * interpolates. A key rather than a string so the button is not the one piece
 * of this screen stuck in English.
 */
export function packOverrideLabel(row: PackRow): {
  key: string;
  count: number;
  tone: "none" | "grant" | "revoke" | "mixed";
} {
  const grants = row.permissions.filter(
    (item) => item.override?.mode === "grant",
  ).length;
  const revokes = row.permissions.filter(
    (item) => item.override?.mode === "revoke",
  ).length;

  if (grants === row.total) {
    return {
      key: row.total > 1 ? "overrideGrantAll" : "overrideGrant",
      count: grants,
      tone: "grant",
    };
  }
  if (revokes === row.total) {
    return {
      key: row.total > 1 ? "overrideRevokeAll" : "overrideRevoke",
      count: revokes,
      tone: "revoke",
    };
  }
  if (grants + revokes === 0) {
    return { key: "overrideNone", count: 0, tone: "none" };
  }
  return { key: "overrideMixed", count: grants + revokes, tone: "mixed" };
}
