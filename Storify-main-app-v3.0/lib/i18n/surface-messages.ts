import type { AbstractIntlMessages } from "next-intl";

/**
 * Message namespaces that only the back office renders: the admin, vendor and
 * staff dashboards. The storefront's `NextIntlClientProvider` leaves them out.
 *
 * Why: `admin` alone is 172 KB of the 293 KB English bundle, and every
 * storefront page used to ship the whole bundle inside its HTML — 43 % of a
 * product page, for strings a shopper can never see. Server components are
 * unaffected (`getTranslations` reads the full request config); this only
 * decides what *client* components can translate. The dashboard layouts mount
 * their own provider with the full bundle, so nothing changes for them.
 */
export const BACK_OFFICE_NAMESPACES = [
  "admin",
  "vendor",
  "aiSalesAgentAdmin",
  "aiStudio",
  "aiStudioHub",
  "adminProfile",
  "boosts",
  "finance",
  "permissionPacks",
  // The POS terminal is a staff screen; the dashboards carry it.
  "pos",
] as const;

/**
 * Namespaces only some storefront routes render in full. Those routes mount
 * their own provider carrying them (`RouteMessages`,
 * components/language/route-messages.tsx), so the bundle every other
 * storefront page ships leaves them out:
 *
 * - `chat` (13 KB) — the customer inbox, app/[locale]/(store)/account/inbox.
 *   Everywhere else the storefront reads five of its keys, listed below.
 * - `install` — the installer, whose page mounts the full bundle.
 * - `checkout` (10 KB), `account` and `orders` (4 KB each) — checkout, the
 *   cart, the account area and the order, pre-order and tracking pages. The
 *   header, on every page, reads one `orders` key.
 */
export const ROUTE_SCOPED_NAMESPACES = [
  "chat",
  "install",
  "checkout",
  "account",
  "orders",
] as const;

export type RouteScopedNamespace = (typeof ROUTE_SCOPED_NAMESPACES)[number];

/**
 * Sub-trees of route-scoped namespaces that even the routes carrying the
 * namespace leave out, because a single page renders them. That page adds
 * them to the messages of the provider above it (`PageMessages`,
 * components/language/page-messages.tsx):
 *
 * - `orders.returns` (3.5 KB) — the customer's returns and refunds, on the
 *   account's order page only.
 */
export const PAGE_SCOPED_PATHS = [
  "orders.returns",
] as const satisfies readonly `${RouteScopedNamespace}.${string}`[];

export type PageScopedPath = (typeof PAGE_SCOPED_PATHS)[number];

/**
 * The few sub-trees of left-out namespaces (back-office or route-scoped) that
 * storefront client code does read, as dotted paths under their namespace.
 * Deliberately narrow: `admin.settings` is 45 KB and the storefront needs one
 * string of it. `tests/i18n-surface-messages.test.ts`
 * scans the storefront source for back-office keys and fails when one is not
 * covered here, so a new usage cannot silently render as a raw key.
 */
export const STOREFRONT_BACK_OFFICE_PATHS: Readonly<
  Record<string, readonly string[]>
> = {
  // Account menu / header link label; the payment method names the account
  // order page shares with the dashboards
  // (components/common/payment-method-meta.ts).
  admin: [
    "settings.title",
    "dashboardPage.payment",
    "paymentTransactionsPage.providers",
  ],
  // The chat button on product and vendor pages and the sign-in prompt it
  // opens for a guest. The button labels and the click-to-chat channels
  // those pages draw on the server come from `getTranslations` instead.
  chat: [
    "chatWithVendor",
    "signInToChatTitle",
    "signInToChatDescription",
    "cancel",
    "signIn",
  ],
  // "My orders" in the header and the mobile menu.
  orders: ["myOrders"],
  // Become-a-vendor wizard (its approved card's dashboard button included),
  // vendor directory, vendor storefront chrome, and the password rules the
  // account page shares with the vendor settings form.
  vendor: [
    "becomeVendor",
    "directory",
    "goToDashboard",
    "onboarding",
    "registration",
    "settingsForm",
    "storefront",
  ],
};

const leftOut: ReadonlySet<string> = new Set([
  ...BACK_OFFICE_NAMESPACES,
  ...ROUTE_SCOPED_NAMESPACES,
]);

/** The value at a dotted path, or `undefined` when any segment is missing. */
export function getMessageAt(
  messages: AbstractIntlMessages,
  path: string,
): unknown {
  let node: unknown = messages;
  for (const segment of path.split(".")) {
    if (!isRecord(node)) return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * One bundle per request's messages: the root layout's provider and a route's
 * then hold the very same sub-tree objects, which React Flight sends once.
 */
const pickedByMessages = new WeakMap<AbstractIntlMessages, AbstractIntlMessages>();

/**
 * The message bundle a storefront page sends to the client: every namespace
 * except the back-office and route-scoped ones, plus the sub-trees listed
 * above. Shared — never modify what it returns.
 */
export function pickStorefrontMessages(
  messages: AbstractIntlMessages,
): AbstractIntlMessages {
  const cached = pickedByMessages.get(messages);
  if (cached) return cached;
  const picked: AbstractIntlMessages = {};

  for (const [namespace, value] of Object.entries(messages)) {
    if (!leftOut.has(namespace)) picked[namespace] = value;
  }

  for (const [namespace, paths] of Object.entries(STOREFRONT_BACK_OFFICE_PATHS)) {
    for (const path of paths) {
      const value = getMessageAt(messages, `${namespace}.${path}`);
      if (value === undefined) continue;
      setMessageAt(picked, `${namespace}.${path}`, value);
    }
  }

  pickedByMessages.set(messages, picked);
  return picked;
}

/**
 * The bundle for a storefront route that renders route-scoped namespaces: the
 * storefront bundle plus those namespaces, less their page-scoped sub-trees.
 * A nested `NextIntlClientProvider` replaces its parent's messages rather than
 * merging with them, so the route's provider carries both; React Flight sends
 * the namespace objects the two bundles share once.
 */
export function withRouteMessages(
  messages: AbstractIntlMessages,
  namespaces: readonly RouteScopedNamespace[],
): AbstractIntlMessages {
  let picked: AbstractIntlMessages = { ...pickStorefrontMessages(messages) };
  for (const namespace of namespaces) picked[namespace] = messages[namespace];
  for (const path of PAGE_SCOPED_PATHS) picked = withoutMessageAt(picked, path);
  return picked;
}

/**
 * Page-scoped sub-trees as a bundle of their own: what a page adds to the
 * messages its route already provides.
 */
export function pickPageMessages(
  messages: AbstractIntlMessages,
  paths: readonly PageScopedPath[],
): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};
  for (const path of paths) {
    const value = getMessageAt(messages, path);
    if (value !== undefined) setMessageAt(picked, path, value);
  }
  return picked;
}

/**
 * `tree` without the value at a dotted path. Copies only the objects on that
 * path, so everything else stays the same object for React Flight to dedupe.
 */
function withoutMessageAt(
  tree: AbstractIntlMessages,
  path: string,
): AbstractIntlMessages {
  const [head, ...rest] = path.split(".");
  const child = tree[head];
  if (child === undefined) return tree;
  const copy = { ...tree };
  if (rest.length === 0) delete copy[head];
  else if (isRecord(child)) copy[head] = withoutMessageAt(child, rest.join("."));
  return copy;
}

function setMessageAt(
  target: AbstractIntlMessages,
  path: string,
  value: unknown,
): void {
  const segments = path.split(".");
  let node: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    if (isRecord(next)) {
      node = next;
    } else {
      const created: Record<string, unknown> = {};
      node[segment] = created;
      node = created;
    }
  }
  node[segments[segments.length - 1]] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
