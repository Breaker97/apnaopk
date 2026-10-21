/**
 * One value per server process, however many copies of the calling module the
 * bundler made.
 *
 * Next bundles route handlers and pages as separate module graphs, so a module
 * imported by both is evaluated once per graph, and its module-level state
 * exists once per copy. That is harmless for a cache. It is not for state that
 * every copy must agree on: an AsyncLocalStorage that one copy writes and
 * another reads (the finance session, the inventory write context), or the
 * "hooks installed" mark on a mongoose model, which is itself shared through
 * mongoose's registry — two copies each wrapped the model's writes, and every
 * stock change was captured twice.
 */
export function processSingleton<T>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  const slot = Symbol.for(`storify:${key}`);
  return (store[slot] ??= create());
}
