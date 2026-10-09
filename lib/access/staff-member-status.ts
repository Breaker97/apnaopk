/**
 * One Status for a team member, with a precedence: a suspended account outranks
 * an inactive one, which outranks a staff profile whose access is switched off.
 * The two underlying fields stay separate toggles on the edit page.
 *
 * Shared by the Team table and its CSV export, so the file and the screen cannot
 * name the same member two different things.
 */
export function resolveMemberStatus(row: {
  status?: string;
  staffProfile?: { isActive: boolean } | null;
}) {
  if (row.status === "banned") return "suspended" as const;
  if (row.status === "inactive") return "inactive" as const;
  if (row.staffProfile && !row.staffProfile.isActive) {
    return "accessOff" as const;
  }
  return "active" as const;
}
