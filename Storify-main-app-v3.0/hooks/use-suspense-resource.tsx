"use client";

/**
 * A browser-side cache for the JSON endpoints a page reads once and then keeps
 * reading from memory — the customer account's profile, orders, addresses and
 * the rest.
 *
 * Each of those pages used to fetch in a mount effect behind its own
 * `if (isLoading)` spinner. Leaving a page unmounts it, so coming back fetched
 * the same answer again behind the same spinner: Orders → Profile → Orders was
 * three requests and three loading flashes for data that had not changed. The
 * profile page asked for `/api/user/profile` three times at once — the form,
 * and the avatar picker in both the sidebar and the mobile strip.
 *
 * What a reader gets instead:
 *
 * - **Suspense on the first read.** The read suspends and the nearest
 *   `<ClientSuspense>` shows its fallback, so a page draws its loading state
 *   once, in its own markup.
 * - **One request per url.** Readers of the same url share it, mounted
 *   together or one after another.
 * - **No request on the way back.** A page that is visited again renders the
 *   held answer at once. Once that answer is older than `staleTime` it is
 *   still rendered at once, then refetched in the background and swapped in —
 *   no fallback either way.
 * - **Writes keep it current.** `mutate` stores what the server confirmed and
 *   `refresh` refetches without suspending, so a page that saved something
 *   shows the saved version when it is opened again.
 *
 * Failures settle as values (`error`), not as rejections, so a component keeps
 * its own error UI and needs no error boundary. A failed answer is not kept for
 * the next visit: that visit asks again.
 *
 * Answers are kept per signed-in user. An authenticated layout names the user
 * from its server session with `ResourceScope`; the key carries that id, so
 * whoever signs in next on the same tab never reads the previous person's
 * answers. Outside a scope nothing outlives the component that read it.
 */

import {
  createContext,
  use,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/** A failed read. `status` is set when the request reached the server. */
interface ResourceError extends Error {
  status?: number;
}

/**
 * What a read settles to: the data, or the reason there is none. `fetchedAt`
 * is when this value was fetched or written.
 */
type ResourceState<T> = (
  | { data: T; error: null }
  | { data: undefined; error: ResourceError }
) & { fetchedAt: number };

interface Resource<T> {
  /**
   * Pass it to `use()`. The same object until the value changes, so reading it
   * again after it settled returns synchronously.
   */
  promise: Promise<ResourceState<T>>;
  /**
   * Refetch without suspending: the current value stays on screen until the
   * new one lands. A failed refetch keeps the value it had.
   */
  refresh: () => Promise<void>;
  /** Store a value the server has confirmed, or derive one from the current. */
  mutate: (next: T | ((current: T) => T)) => void;
}

interface ResourceOptions<T> {
  /** How to load the value. Defaults to GET `url`, unwrapped from the API envelope. */
  load?: () => Promise<T>;
  /** Age after which a new visit refetches in the background. */
  staleTime?: number;
}

/** How long a held answer counts as current before a visit refetches it. */
export const DEFAULT_STALE_TIME_MS = 60_000;

/** How long a scoped answer is kept once no mounted component reads it. */
const SCOPED_GC_TIME_MS = 30 * 60_000;

/**
 * How long an answer no mounted component has read yet is kept. Covers the
 * render that suspended on it, which renders again the moment it lands.
 */
const UNCLAIMED_GRACE_MS = 5_000;

type Thenable<T> = Promise<T> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

type AnyState = ResourceState<unknown>;

interface Entry {
  promise: Thenable<AnyState>;
  /** Bumped by every write, so a refetch that started before one cannot undo it. */
  version: number;
  refreshing: Promise<void> | null;
  /** Read inside a `ResourceScope`, and therefore kept after its readers leave. */
  scoped: boolean;
  /** When the last mounted reader left; null while one is mounted, or none ever was. */
  releasedAt: number | null;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const KEY_SEPARATOR = "\u0000";

function cacheKey(owner: string | null, url: string): string {
  return `${owner ?? ""}${KEY_SEPARATOR}${url}`;
}

function urlOf(key: string): string {
  return key.slice(key.indexOf(KEY_SEPARATOR) + 1);
}

/**
 * Marks a promise with the fields `use()` checks, so a settled one is read
 * synchronously instead of suspending for a microtask.
 */
function tracked<T>(promise: Promise<T>): Thenable<T> {
  const thenable = promise as Thenable<T>;
  thenable.status = "pending";
  thenable.then(
    (value) => {
      thenable.status = "fulfilled";
      thenable.value = value;
    },
    (reason) => {
      thenable.status = "rejected";
      thenable.reason = reason;
    },
  );
  return thenable;
}

function settledThenable<T>(value: T): Thenable<T> {
  const thenable = Promise.resolve(value) as Thenable<T>;
  thenable.status = "fulfilled";
  thenable.value = value;
  return thenable;
}

function resourceError(message: string, status?: number): ResourceError {
  const error: ResourceError = new Error(message);
  if (typeof status === "number") error.status = status;
  return error;
}

/** GET a url that answers with the `{ success, data }` envelope (lib/api/response.ts). */
async function fetchEnvelope<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const json = await response.json().catch(() => null);
  if (response.ok === false || !json?.success) {
    throw resourceError(
      json?.message ||
        json?.error ||
        `Request failed with status ${response.status}`,
      response.status,
    );
  }
  return json.data as T;
}

async function settle<T>(load: () => Promise<T>): Promise<ResourceState<T>> {
  try {
    const data = await load();
    return { data, error: null, fetchedAt: Date.now() };
  } catch (caught) {
    return {
      data: undefined,
      error:
        caught instanceof Error
          ? (caught as ResourceError)
          : resourceError(String(caught)),
      fetchedAt: Date.now(),
    };
  }
}

function settledState(entry: Entry): AnyState | undefined {
  return entry.promise.status === "fulfilled" ? entry.promise.value : undefined;
}

function readerCount(key: string): number {
  return listeners.get(key)?.size ?? 0;
}

/** Whether a held entry should be dropped rather than handed to a new reader. */
function expired(key: string, entry: Entry, now: number): boolean {
  const state = settledState(entry);
  // Still loading: join it. Being read right now: keep serving it.
  if (!state || readerCount(key) > 0) return false;
  if (entry.scoped && !state.error) {
    return now - (entry.releasedAt ?? state.fetchedAt) > SCOPED_GC_TIME_MS;
  }
  // Failures, and answers read outside a scope, are not kept for a later
  // visit: once their reader has left, the next one asks again.
  return entry.releasedAt !== null || now - state.fetchedAt > UNCLAIMED_GRACE_MS;
}

function ensureEntry(
  key: string,
  load: () => Promise<AnyState>,
  scoped: boolean,
): Entry {
  const held = entries.get(key);
  if (held && !expired(key, held, Date.now())) return held;

  const entry: Entry = {
    promise: tracked(load()),
    version: 0,
    refreshing: null,
    scoped,
    releasedAt: null,
  };
  entries.set(key, entry);
  return entry;
}

function subscribe(key: string, onChange: () => void): () => void {
  let keyListeners = listeners.get(key);
  if (!keyListeners) {
    keyListeners = new Set();
    listeners.set(key, keyListeners);
  }
  keyListeners.add(onChange);
  const entry = entries.get(key);
  if (entry) entry.releasedAt = null;

  return () => {
    keyListeners.delete(onChange);
    if (keyListeners.size > 0) return;
    const current = entries.get(key);
    if (current) current.releasedAt = Date.now();
  };
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function store(key: string, entry: Entry, state: AnyState) {
  entry.promise = settledThenable(state);
  entry.version += 1;
  notify(key);
}

function refreshEntry(
  key: string,
  load: () => Promise<AnyState>,
): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return Promise.resolve();
  // The first load is still out; a second request would only race it.
  if (!settledState(entry)) return entry.promise.then(() => undefined);
  if (entry.refreshing) return entry.refreshing;

  const version = entry.version;
  const refreshing: Promise<void> = load()
    .then((state) => {
      // Evicted, or written since this started: the newer value stands.
      if (entries.get(key) !== entry || entry.version !== version) return;
      // A failed refetch keeps the answer on screen rather than trading it
      // for an error.
      if (state.error && !settledState(entry)?.error) return;
      store(key, entry, state);
    })
    .finally(() => {
      if (entry.refreshing === refreshing) entry.refreshing = null;
    });
  entry.refreshing = refreshing;
  return refreshing;
}

function mutateEntry<T>(key: string, next: T | ((current: T) => T)) {
  const entry = entries.get(key);
  if (!entry) return;
  let data: T;
  if (typeof next === "function") {
    const current = settledState(entry);
    if (!current || current.error) return;
    data = (next as (current: T) => T)(current.data as T);
  } else {
    data = next;
  }
  store(key, entry, { data, error: null, fetchedAt: Date.now() });
}

/**
 * Drops held answers so the next read fetches afresh (and suspends again).
 * Pass `match` to drop only the urls it accepts. A component still reading
 * one of them is told, and reads again at once.
 *
 * For writes made somewhere a cached page cannot see — checkout placing an
 * order touches the order list, store credit and saved addresses at once.
 */
export function invalidateResources(match?: (url: string) => boolean) {
  for (const key of [...entries.keys()]) {
    if (match && !match(urlOf(key))) continue;
    entries.delete(key);
    notify(key);
  }
}

const ResourceScopeContext = createContext<string | null>(null);

/**
 * Names the signed-in user whose answers may be kept across pages. Rendered
 * by an authenticated layout from its own server session, so the id is
 * always the one the server authorised — never a client guess that could
 * still name the previous user after a sign-in.
 */
export function ResourceScope({
  owner,
  children,
}: {
  owner: string;
  children: ReactNode;
}) {
  return (
    <ResourceScopeContext.Provider value={owner}>
      {children}
    </ResourceScopeContext.Provider>
  );
}

function refuseOnServer(): never {
  // A relative `/api` url cannot be fetched from the server render, and the
  // session cookie is not there either. `<ClientSuspense>` keeps its children
  // off the server, which is where every reader belongs.
  throw new Error(
    "useResource reads from the browser: render it inside <ClientSuspense>.",
  );
}

/**
 * The cached resource at `url`, loading it on first use. Does not suspend by
 * itself: pass `promise` to `use()`. Several reads started before the first
 * `use()` load in parallel rather than one after another.
 */
export function useResource<T>(
  url: string,
  options: ResourceOptions<T> = {},
): Resource<T> {
  const owner = useContext(ResourceScopeContext);
  const key = cacheKey(owner, url);
  const { load, staleTime = DEFAULT_STALE_TIME_MS } = options;

  // Read by `refresh` and the background refetch, which outlive the render
  // that passed `load`. Mirrored in an effect, not during render: the React
  // Compiler may reorder a ref written mid-render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const subscribeToKey = useCallback(
    (onChange: () => void) => subscribe(key, onChange),
    [key],
  );
  const getSnapshot = () =>
    ensureEntry(
      key,
      () => settle(load ?? (() => fetchEnvelope<T>(url))),
      owner !== null,
    ).promise;
  const promise = useSyncExternalStore(
    subscribeToKey,
    getSnapshot,
    refuseOnServer,
  );

  const refresh = useCallback(
    () =>
      refreshEntry(key, () =>
        settle(loadRef.current ?? (() => fetchEnvelope<T>(url))),
      ),
    [key, url],
  );
  const mutate = useCallback(
    (next: T | ((current: T) => T)) => mutateEntry(key, next),
    [key],
  );

  // A visit to a page whose answer has gone stale shows it at once and
  // refetches behind it. Only on arrival: this is not a poll (see
  // `useLiveResource` for data that has to stay live while on screen).
  useEffect(() => {
    const entry = entries.get(key);
    const state = entry ? settledState(entry) : undefined;
    if (!state || state.error) return;
    if (Date.now() - state.fetchedAt < staleTime) return;
    void refresh();
  }, [key, staleTime, refresh]);

  return {
    promise: promise as Promise<ResourceState<T>>,
    refresh,
    mutate,
  };
}

/**
 * The cached resource at `url`, suspending until its first answer. Render it
 * inside `<ClientSuspense>`, whose fallback is the loading state.
 */
export function useSuspenseResource<T>(
  url: string,
  options?: ResourceOptions<T>,
) {
  const { promise, refresh, mutate } = useResource<T>(url, options);
  const state = use(promise);
  return { ...state, refresh, mutate };
}
