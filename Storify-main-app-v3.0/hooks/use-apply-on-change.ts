"use client";

import { useState } from "react";

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Runs `apply` during render on the first render and again whenever `deps`
 * change (compared the way an effect's dependency list is).
 *
 * This is React's "adjust some state when a prop changes" pattern with the
 * bookkeeping folded away: the component re-renders with the adjusted state
 * before anything is committed, instead of committing the stale state and
 * then re-rendering from an effect — the cascade the
 * `react-hooks/set-state-in-effect` rule points at.
 *
 * `apply` may only call state setters of the component that owns the hook.
 * Never write refs, touch the DOM, start requests or timers in it: those are
 * still effect work. Reads must be pure for the same `deps`.
 *
 * Every dep must keep its identity across the component's own re-renders:
 * state, memoised values, props, hook results or primitives. A value rebuilt
 * on each render (an unmemoised call result, an inline object or array) never
 * compares equal here, and where an effect would merely re-run, this
 * re-renders until React aborts with "Too many re-renders". Memoise it or
 * pass a primitive key instead.
 */
export function useApplyOnChange(
  deps: readonly unknown[],
  apply: () => void,
): void {
  const [applied, setApplied] = useState<readonly unknown[] | null>(null);
  if (applied === null || !sameDeps(applied, deps)) {
    setApplied(deps);
    apply();
  }
}
