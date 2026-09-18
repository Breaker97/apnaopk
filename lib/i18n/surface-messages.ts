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
] as const;

/**
 * The few back-office sub-trees storefront client code does read, as dotted
 * paths under their namespace. Deliberately narrow: `admin.settings` is 45 KB
 * and the storefront needs one string of it. `tests/i18n-surface-messages.test.ts`
 * scans the storefront source for back-office keys and fails when one is not
 * covered here, so a new usage cannot silently render as a raw key.
 */
export const STOREFRONT_BACK_OFFICE_PATHS: Readonly<
  Record<string, readonly string[]>
> = {
  // Account menu / header link label; the card studio's element labels; the
  // payment method names the account order page shares with the dashboards
  // (components/common/payment-method-meta.ts).
  admin: [
    "settings.title",
    "productCardStudio",
    "dashboardPage.payment",
    "paymentTransactionsPage.providers",
  ],
  // Become-a-vendor wizard, vendor directory, vendor storefront chrome, and
  // the password rules the account page shares with the vendor settings form.
  vendor: [
    "becomeVendor",
    "directory",
    "onboarding",
    "registration",
    "settingsForm",
    "storefront",
  ],
};

const backOffice: ReadonlySet<string> = new Set(BACK_OFFICE_NAMESPACES);

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
 * The message bundle a storefront page sends to the client: every namespace
 * except the back-office ones, plus the sub-trees listed above.
 */
export function pickStorefrontMessages(
  messages: AbstractIntlMessages,
): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};

  for (const [namespace, value] of Object.entries(messages)) {
    if (!backOffice.has(namespace)) picked[namespace] = value;
  }

  for (const [namespace, paths] of Object.entries(STOREFRONT_BACK_OFFICE_PATHS)) {
    for (const path of paths) {
      const value = getMessageAt(messages, `${namespace}.${path}`);
      if (value === undefined) continue;
      setMessageAt(picked, `${namespace}.${path}`, value);
    }
  }

  return picked;
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
