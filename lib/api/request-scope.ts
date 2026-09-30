import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A memo that lives as long as one request, for route handlers.
 *
 * React's `cache()` memoizes only while a server component renders; in a route
 * handler it hands back a fresh map on every call. So a checkout read the
 * store's settings three times — three database round trips on the path a
 * shopper waits on. A route that opens a scope with `withRequestScope` reads
 * each memoized value once for the whole request.
 *
 * Opt-in, per route: a route that writes settings and then reads them back
 * must not be handed the value from before its own write.
 */
const scopes = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withRequestScope<T>(run: () => Promise<T>): Promise<T> {
  return scopes.run(new Map(), run);
}

/** `load()` once per key within a request scope; every call outside one. */
export function requestMemo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) return load();
  let pending = scope.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = load();
    scope.set(key, pending);
    // A failed read is not remembered: the next caller tries again.
    pending.catch(() => scope.delete(key));
  }
  return pending;
}
