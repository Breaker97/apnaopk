/**
 * The full plan order after an admin drags a plan.
 *
 * `requested` is the order the admin's screen held. Ids in it that no longer
 * exist are dropped, and plans it does not name — one another admin created
 * meanwhile — keep their relative place after it, so a stale screen can never
 * leave two plans on the same position.
 */
export function mergePlanOrder(
  current: readonly string[],
  requested: readonly string[],
): string[] {
  const known = new Set(current);
  const placed = new Set<string>();
  const head: string[] = [];
  for (const id of requested) {
    if (known.has(id) && !placed.has(id)) {
      placed.add(id);
      head.push(id);
    }
  }
  return [...head, ...current.filter((id) => !placed.has(id))];
}
