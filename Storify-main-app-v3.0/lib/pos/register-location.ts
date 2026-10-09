/**
 * Which counter THIS machine is standing at.
 *
 * Scoped to the browser, not to the user account, because a register is a
 * physical thing: two tills in the same shop are two devices, and a cashier who
 * covers both during one shift must not drag their choice from one to the
 * other. It is the same reasoning that already keeps held orders in
 * `localStorage` — see `lib/pos/held-orders.ts`.
 *
 * The stored id is a HINT, never an authority. Every request that carries it is
 * re-resolved against the caller's own locations by `resolvePOSLocationId`, so
 * a hand-edited value can only ever fall back to the caller's default counter —
 * it can never point the register at another merchant's stock.
 */

const STORAGE_KEY = "pos:register:locationId";

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/**
 * The id this machine last sold from, `""` if the cashier chose shared stock,
 * or null if it has never been asked.
 *
 * All three are distinct answers, so this returns `getItem` verbatim. Collapsing
 * the empty string to null — which a truthiness check does — threw away the one
 * `writeRegisterLocation` stores deliberately, and "sell from shared stock
 * instead" then failed to stick: the picker reopened on every load because the
 * choice read as never having been made.
 */
export function readRegisterLocation(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode and blocked site data both throw on read. A register that
    // cannot remember its counter still has to open.
    return null;
  }
}

/**
 * Remember the counter. An empty id means "shared stock" and is stored as a
 * real choice rather than removed — the difference between a cashier who picked
 * "no counter" and one who has not picked yet is what decides whether the
 * shift-start picker opens.
 */
export function writeRegisterLocation(locationId: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locationId);
  } catch {
    // Storage is full or blocked. The choice still applies for this session;
    // it just will not survive a reload, which is better than refusing it.
  }
}

// ------------------------------------------------------------------- history

const RECENTS_KEY = "pos:register:recentLocationIds";

/**
 * How many counters a machine is worth remembering.
 *
 * Three, because a till realistically works one counter and occasionally covers
 * a second; a longer list is history nobody reads and a section that crowds out
 * the counters a cashier actually has to choose between.
 */
const RECENT_LIMIT = 3;

/**
 * The counters this machine has sold from, most recent first.
 *
 * A SEPARATE key from `pos:register:locationId`, and that separation is the
 * whole point. The active key is overwritten by every switch and is the thing
 * that goes missing — never set, or pointing at a branch since deactivated —
 * which is exactly when the shift-start question is asked. Reading history out
 * of it therefore always came back empty, which is why the picker's old "last
 * used" marker could never once appear.
 *
 * This one is only ever appended to, so it survives the active choice being
 * lost and can still say where this till usually stands.
 */
export function readRecentLocations(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, RECENT_LIMIT);
  } catch {
    // Unparseable or unreadable. History is a convenience; losing it costs a
    // tap, so it must never be able to stop the register opening.
    return [];
  }
}

/**
 * Record a counter as this machine's most recent.
 *
 * Shared stock is deliberately NOT recorded: it is the absence of a counter,
 * and offering it back under "recent" would invite a cashier to keep selling a
 * branch's sales against the aggregate pool.
 */
export function pushRecentLocation(locationId: string): void {
  if (!isBrowser() || !locationId) return;
  try {
    const next = [
      locationId,
      ...readRecentLocations().filter((id) => id !== locationId),
    ].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Same as the active key: a register that cannot remember still has to sell.
  }
}

// ------------------------------------------------------------------ matching

/**
 * Counters matching what a cashier typed, best match first.
 *
 * Ranked rather than merely filtered, because a plain `includes` over both
 * fields answers with whatever happens to sort first. Typing "utt" at a store
 * with a branch called *Uttara* and a pickup point in *Uttar Badda* selected the
 * pickup point — an area match beating the branch whose NAME the cashier was
 * spelling out. Somebody typing a name means the name.
 *
 * Four tiers: name prefix, name anywhere, area prefix, area anywhere. Ties keep
 * the order they came in, which is the merchant's own (default first, then
 * alphabetical), so the ranking never scrambles a list that was already right.
 */
export function matchPOSLocations<T extends { name: string; area: string }>(
  locations: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return locations;

  const ranked: Array<{ location: T; rank: number; index: number }> = [];

  locations.forEach((location, index) => {
    const name = location.name.toLowerCase();
    const area = (location.area || "").toLowerCase();

    const rank = name.startsWith(needle)
      ? 0
      : name.includes(needle)
        ? 1
        : area.startsWith(needle)
          ? 2
          : area.includes(needle)
            ? 3
            : -1;

    if (rank >= 0) ranked.push({ location, rank, index });
  });

  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.location);
}

// ---------------------------------------------------------------- appearance

/**
 * The palette a branch dot is drawn from.
 *
 * One lightness and chroma, six hues — so no branch reads as more important
 * than another, and every dot holds the same contrast against both themes.
 * Written as literal hex rather than a theme token on purpose: this colour
 * identifies a place, so it must be identical in light mode, dark mode and on a
 * printed receipt.
 */
const LOCATION_ACCENTS = [
  "#2F7CE0",
  "#00A06A",
  "#CF6B3E",
  "#A15BD6",
  "#00A0B5",
  "#C2496E",
] as const;

/**
 * A stable colour for a location id.
 *
 * Derived rather than stored, so a merchant never has to pick one and a branch
 * keeps its colour across devices and reinstalls. The cashier learns "blue is
 * Gulshan" and stops reading the label — which is the whole point of the dot.
 */
export function posLocationAccent(locationId: string): string {
  if (!locationId) return "#8A8A8A";

  let hash = 0;
  for (let i = 0; i < locationId.length; i++) {
    hash = (hash * 31 + locationId.charCodeAt(i)) >>> 0;
  }
  return LOCATION_ACCENTS[hash % LOCATION_ACCENTS.length];
}

/**
 * The two- or three-letter code the compact badge shows below `lg`, where the
 * full branch name will not fit beside the search field.
 *
 * Built from the words of the name so "Gulshan Branch" reads GUL and "Mirpur 10
 * Counter" reads M10 — a cashier recognises their own counter's code instantly,
 * which a numeric index or a truncated id would not give them.
 */
export function posLocationShortCode(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "—";

  // A single word carries the identity on its own: take its opening letters
  // rather than one initial, so "Gulshan" is GUL and not G.
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();

  // Words that only say what kind of place it is are what every branch shares,
  // so they cannot be the thing that tells two apart.
  const GENERIC = new Set([
    "branch",
    "counter",
    "outlet",
    "store",
    "shop",
    "warehouse",
    "location",
    "point",
  ]);
  const distinct = words.filter(
    (word) => !GENERIC.has(word.toLowerCase().replace(/[^a-z]/g, "")),
  );
  const source = distinct.length > 0 ? distinct : words;

  if (source.length === 1) return source[0].slice(0, 3).toUpperCase();
  return source
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
