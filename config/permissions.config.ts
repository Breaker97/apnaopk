/**
 * Permissions Configuration
 * Central configuration for RBAC permissions across the platform
 */

// ============================================
// Admin Permissions
// ============================================

export const ADMIN_PERMISSIONS = {
  // User Management
  MANAGE_USERS: "manage_users",
  VIEW_USERS: "view_users",

  // Vendor Management
  APPROVE_VENDORS: "approve_vendors",
  MANAGE_VENDORS: "manage_vendors",

  // Product Management
  MANAGE_ALL_PRODUCTS: "manage_all_products",

  // Order Management
  VIEW_ALL_ORDERS: "view_all_orders",
  MANAGE_ALL_ORDERS: "manage_all_orders",

  // Category Management
  MANAGE_CATEGORIES: "manage_categories",

  // Settings
  MANAGE_SETTINGS: "manage_settings",

  // Analytics
  VIEW_ANALYTICS: "view_analytics",

  // Finance
  VIEW_PAYMENTS: "view_payments",
  /**
   * Moving money back to a shopper. Enforced by `canIssueRefunds` in
   * lib/rbac.ts, which is the ONLY place the question is answered — the admin
   * order route, the admin return route and the vendor return route all defer
   * to it. Scoped to the admin role rather than to a per-admin grant, because
   * Storify collects on the platform's own gateway credentials and a refund
   * therefore spends the platform's money.
   */
  MANAGE_REFUNDS: "manage_refunds",
  MANAGE_PAYOUTS: "manage_payouts",
} as const;

export type AdminPermission =
  (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

// ============================================
// Vendor Permissions (for vendor staff/seller)
// ============================================

export const VENDOR_PERMISSIONS = {
  // Products
  VIEW_PRODUCTS: "view_products",
  MANAGE_PRODUCTS: "manage_products",
  CREATE_PRODUCTS: "create_products",
  EDIT_PRODUCTS: "edit_products",
  DELETE_PRODUCTS: "delete_products",

  // Orders
  VIEW_ORDERS: "view_orders",
  MANAGE_ORDERS: "manage_orders",
  CREATE_ORDERS: "create_orders",
  EDIT_ORDERS: "edit_orders",
  DELETE_ORDERS: "delete_orders",

  // Store settings
  VIEW_STORE_SETTINGS: "view_store_settings",
  MANAGE_STORE_SETTINGS: "manage_store_settings",
  EDIT_STORE_SETTINGS: "edit_store_settings",

  // Staff
  VIEW_STAFF: "view_staff",
  MANAGE_STAFF: "manage_staff",
  CREATE_STAFF: "create_staff",
  EDIT_STAFF: "edit_staff",
  DELETE_STAFF: "delete_staff",

  // Analytics
  VIEW_ANALYTICS: "view_analytics",

  // Brands (vendor-created brands enter an admin moderation queue; deletion is
  // admin-only via soft-delete, so there is no vendor delete permission).
  VIEW_BRANDS: "view_brands",
  CREATE_BRANDS: "create_brands",
  EDIT_BRANDS: "edit_brands",

  // Discounts
  VIEW_DISCOUNTS: "view_discounts",
  MANAGE_DISCOUNTS: "manage_discounts",
  CREATE_DISCOUNTS: "create_discounts",
  EDIT_DISCOUNTS: "edit_discounts",
  DELETE_DISCOUNTS: "delete_discounts",

  // Product boosting (sponsored placements a vendor purchases)
  VIEW_BOOSTS: "view_boosts",
  MANAGE_BOOSTS: "manage_boosts",

  // Payouts
  VIEW_PAYOUTS: "view_payouts",
  MANAGE_PAYOUTS: "manage_payouts",

  // Omnichannel inbox
  VIEW_INBOX: "view_inbox",
  REPLY_INBOX: "reply_inbox",
  MANAGE_INBOX: "manage_inbox",
  MANAGE_CHANNELS: "manage_channels",

  // POS
  ACCESS_POS: "access_pos",

  // AI Studio — access to AI authoring tools. A single access grant (no
  // create/edit/delete): AI Studio is a tool, not a CRUD resource.
  ACCESS_AI_STUDIO: "access_ai_studio",
} as const;

export type VendorPermission =
  (typeof VENDOR_PERMISSIONS)[keyof typeof VENDOR_PERMISSIONS];

// ============================================
// Default Permission Sets
// ============================================

// Super admin gets all permissions
export const SUPER_ADMIN_PERMISSIONS = Object.values(ADMIN_PERMISSIONS);

// Full vendor (store owner) gets all vendor permissions
export const DEFAULT_VENDOR_PERMISSIONS = Object.values(VENDOR_PERMISSIONS);
export const ALL_VENDOR_PERMISSIONS = Object.values(VENDOR_PERMISSIONS);

// Approved-but-unpaid vendors may prepare their catalog and store during the
// seven-day setup window. Financial and operational permissions are excluded:
// no orders, returns, discounts, staff, POS, payouts, or AI usage.
export const PAYMENT_REQUIRED_SETUP_PERMISSIONS: VendorPermission[] = [
  VENDOR_PERMISSIONS.VIEW_PRODUCTS,
  VENDOR_PERMISSIONS.MANAGE_PRODUCTS,
  VENDOR_PERMISSIONS.CREATE_PRODUCTS,
  VENDOR_PERMISSIONS.EDIT_PRODUCTS,
  VENDOR_PERMISSIONS.DELETE_PRODUCTS,
  VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
  VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
  VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS,
  VENDOR_PERMISSIONS.VIEW_BRANDS,
  VENDOR_PERMISSIONS.CREATE_BRANDS,
  VENDOR_PERMISSIONS.EDIT_BRANDS,
];

// Seller role (limited vendor staff) - can only manage products and view orders
export const SELLER_PERMISSIONS: VendorPermission[] = [
  VENDOR_PERMISSIONS.VIEW_PRODUCTS,
  VENDOR_PERMISSIONS.VIEW_ORDERS,
  VENDOR_PERMISSIONS.VIEW_INBOX,
  VENDOR_PERMISSIONS.REPLY_INBOX,
];

// ============================================
// Capability Packs — the unit a plan sells
// ============================================

/**
 * Packs group the 48 permission strings into the ~11 decisions a human actually
 * makes. A plan sells PACKS; overrides and staff lists stay per-permission,
 * because "view orders but not edit" is a legitimate thing to grant a seat.
 *
 * Every permission belongs to exactly one pack (asserted in
 * tests/vendor-permission-packs.test.ts). The strings remain the enforcement
 * primitive — no route guard changes because of this file.
 *
 * See docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.1.
 */
export const VENDOR_PERMISSION_PACKS = {
  catalog: [
    VENDOR_PERMISSIONS.VIEW_PRODUCTS,
    VENDOR_PERMISSIONS.MANAGE_PRODUCTS,
    VENDOR_PERMISSIONS.CREATE_PRODUCTS,
    VENDOR_PERMISSIONS.EDIT_PRODUCTS,
    VENDOR_PERMISSIONS.DELETE_PRODUCTS,
    VENDOR_PERMISSIONS.VIEW_BRANDS,
    VENDOR_PERMISSIONS.CREATE_BRANDS,
    VENDOR_PERMISSIONS.EDIT_BRANDS,
  ],
  orders: [
    VENDOR_PERMISSIONS.VIEW_ORDERS,
    VENDOR_PERMISSIONS.MANAGE_ORDERS,
    VENDOR_PERMISSIONS.CREATE_ORDERS,
    VENDOR_PERMISSIONS.EDIT_ORDERS,
    VENDOR_PERMISSIONS.DELETE_ORDERS,
  ],
  storefront: [
    VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
    VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
    VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS,
  ],
  analytics: [VENDOR_PERMISSIONS.VIEW_ANALYTICS],
  inbox: [
    VENDOR_PERMISSIONS.VIEW_INBOX,
    VENDOR_PERMISSIONS.REPLY_INBOX,
    VENDOR_PERMISSIONS.MANAGE_INBOX,
    VENDOR_PERMISSIONS.MANAGE_CHANNELS,
  ],
  staff: [
    VENDOR_PERMISSIONS.VIEW_STAFF,
    VENDOR_PERMISSIONS.MANAGE_STAFF,
    VENDOR_PERMISSIONS.CREATE_STAFF,
    VENDOR_PERMISSIONS.EDIT_STAFF,
    VENDOR_PERMISSIONS.DELETE_STAFF,
  ],
  discounts: [
    VENDOR_PERMISSIONS.VIEW_DISCOUNTS,
    VENDOR_PERMISSIONS.MANAGE_DISCOUNTS,
    VENDOR_PERMISSIONS.CREATE_DISCOUNTS,
    VENDOR_PERMISSIONS.EDIT_DISCOUNTS,
    VENDOR_PERMISSIONS.DELETE_DISCOUNTS,
  ],
  pos: [VENDOR_PERMISSIONS.ACCESS_POS],
  payouts: [VENDOR_PERMISSIONS.VIEW_PAYOUTS, VENDOR_PERMISSIONS.MANAGE_PAYOUTS],
  boosts: [VENDOR_PERMISSIONS.VIEW_BOOSTS, VENDOR_PERMISSIONS.MANAGE_BOOSTS],
  aiStudio: [VENDOR_PERMISSIONS.ACCESS_AI_STUDIO],
} as const satisfies Record<string, readonly VendorPermission[]>;

export type VendorPermissionPack = keyof typeof VENDOR_PERMISSION_PACKS;

export const ALL_VENDOR_PACKS = Object.keys(
  VENDOR_PERMISSION_PACKS,
) as VendorPermissionPack[];

/** Human labels for the pack, shared by the admin grid and the vendor gate. */
export const VENDOR_PACK_LABELS: Record<VendorPermissionPack, string> = {
  catalog: "Catalog",
  orders: "Orders",
  storefront: "Storefront",
  analytics: "Analytics",
  inbox: "Inbox",
  staff: "Staff",
  discounts: "Discounts",
  pos: "Point of Sale",
  payouts: "Payouts",
  boosts: "Boosts",
  aiStudio: "AI Studio",
};

/** Reverse lookup: which pack owns a permission string. */
export const PACK_OF_PERMISSION: Record<VendorPermission, VendorPermissionPack> =
  (() => {
    const map = {} as Record<VendorPermission, VendorPermissionPack>;
    for (const pack of ALL_VENDOR_PACKS) {
      for (const permission of VENDOR_PERMISSION_PACKS[pack]) {
        map[permission] = pack;
      }
    }
    return map;
  })();

/** Flatten packs to the permission strings the guards check. */
export function expandVendorPacks(
  packs: readonly VendorPermissionPack[],
): VendorPermission[] {
  const out = new Set<VendorPermission>();
  for (const pack of packs) {
    for (const permission of VENDOR_PERMISSION_PACKS[pack] ?? []) {
      out.add(permission);
    }
  }
  return Array.from(out);
}

/**
 * What a vendor holds when NO plan governs them — either the marketplace sells
 * no plans (`vendorConfig.plansEnabled` is off, the default) or they joined on
 * commission terms. Everything needed to sell; nothing the platform pays for.
 *
 * `aiStudio` is deliberately excluded and that exclusion is load-bearing: AI
 * authoring spends the operator's own OpenAI key (lib/ai-authoring/openai.ts),
 * AIUsage records counts rather than cost, and the daily caps default to 0
 * which lib/ai-authoring/usage.ts treats as unlimited. Today the only thing
 * stopping a plan-less vendor from unmetered spend is checkPlanCapability's
 * `if (!planId) return false`. Adding aiStudio here would loosen a live
 * financial control as a side effect of a permissions change.
 *
 * Not a prohibition: an operator who sets a real daily cap can grant the pack,
 * and an expiring override covers trials. See the guideline §2.2.
 */
export const COMMISSION_ONLY_PACKS: VendorPermissionPack[] = [
  "catalog",
  "orders",
  "storefront",
  "analytics",
  "inbox",
  "staff",
  "discounts",
  "pos",
  "payouts",
  "boosts",
];

/**
 * Permissions that used to exist, and the surviving one each still stands for.
 *
 * Retiring a permission is not a delete: the eleven decorative verbs (guideline
 * P4) were never required by a guard, but the implication table let them
 * SATISFY one — holding `create_pos` made an `access_pos` check pass. A stored
 * row that carries only the verb therefore still means something, and simply
 * ignoring the string would take real access away from that vendor.
 *
 * So every reader maps through here. `scripts/migrate-retire-decorative-vendor-
 * permissions.mjs` writes the same promotion down permanently; until it has run
 * (and for any row it misses) this keeps the answer identical.
 */
const RETIRED_VENDOR_PERMISSION_GRANTS: Record<string, VendorPermission> =
  {
    create_analytics: VENDOR_PERMISSIONS.VIEW_ANALYTICS,
    edit_analytics: VENDOR_PERMISSIONS.VIEW_ANALYTICS,
    delete_analytics: VENDOR_PERMISSIONS.VIEW_ANALYTICS,
    create_store_settings: VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
    delete_store_settings: VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
    create_payouts: VENDOR_PERMISSIONS.VIEW_PAYOUTS,
    edit_payouts: VENDOR_PERMISSIONS.VIEW_PAYOUTS,
    delete_payouts: VENDOR_PERMISSIONS.VIEW_PAYOUTS,
    create_pos: VENDOR_PERMISSIONS.ACCESS_POS,
    edit_pos: VENDOR_PERMISSIONS.ACCESS_POS,
    delete_pos: VENDOR_PERMISSIONS.ACCESS_POS,
  };

/**
 * The revoke side, which is deliberately narrower.
 *
 * A revoke cascaded to everything that would otherwise satisfy it. Revoking
 * `create_payouts` also took `manage_payouts` down, so that revoke survives as
 * a revoke of `manage_payouts`. Revoking `create_analytics` or `create_pos`
 * reached nothing else — those resources have no umbrella above the verb — so
 * those revokes are dropped. Promoting them to `view_analytics` or `access_pos`
 * would REMOVE access the vendor holds today, which is the opposite of what a
 * retirement may do.
 */
const RETIRED_VENDOR_PERMISSION_REVOKES: Record<string, VendorPermission> =
  {
    create_store_settings: VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
    delete_store_settings: VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
    create_payouts: VENDOR_PERMISSIONS.MANAGE_PAYOUTS,
    edit_payouts: VENDOR_PERMISSIONS.MANAGE_PAYOUTS,
    delete_payouts: VENDOR_PERMISSIONS.MANAGE_PAYOUTS,
  };

/**
 * Resolve a stored permission string to the live one it stands for.
 *
 * Returns the string unchanged when it is current, the promotion when it is
 * retired, and `null` when it is retired and meant nothing that survives (or is
 * simply unrecognised, e.g. written by a newer deploy that has since rolled
 * back). Callers drop the nulls.
 */
export function resolveStoredVendorPermission(
  permission: string,
  mode: "grant" | "revoke" = "grant",
): VendorPermission | null {
  if (ALL_VENDOR_PERMISSIONS.includes(permission as VendorPermission)) {
    return permission as VendorPermission;
  }
  const table =
    mode === "revoke"
      ? RETIRED_VENDOR_PERMISSION_REVOKES
      : RETIRED_VENDOR_PERMISSION_GRANTS;
  return table[permission] ?? null;
}

/** The capabilities blob stored on a plan, as every reader has to tolerate it. */
export interface VendorPlanCapabilityInput {
  /** Absent = written before packs existed. `[]` = sells nothing, deliberately. */
  packs?: readonly VendorPermissionPack[] | null;
  /** @deprecated superseded by `packs.includes("aiStudio")`. */
  aiAuthoring?: boolean | null;
}

/**
 * The packs a plan's capabilities blob sells, tolerating legacy rows.
 *
 * ABSENT `packs` means the row predates the field: such a plan gated nothing
 * except AI authoring, so it reads as the baseline (plus aiStudio when the old
 * flag was on). An EMPTY array is a deliberate "this plan sells nothing" and is
 * returned as-is — conflating the two is what made a zero-pack plan silently
 * grant everything.
 *
 * The single place that rule lives; `entitledPacks`, `checkPlanCapability` and
 * the pricing cards all read through here so none of them can disagree.
 */
export function packsFromPlanCapabilities(
  capabilities: VendorPlanCapabilityInput | null | undefined,
): VendorPermissionPack[] {
  const packs = capabilities?.packs;
  if (Array.isArray(packs)) {
    return packs.filter((pack): pack is VendorPermissionPack =>
      ALL_VENDOR_PACKS.includes(pack as VendorPermissionPack),
    );
  }
  return capabilities?.aiAuthoring
    ? [...COMMISSION_ONLY_PACKS, "aiStudio"]
    : [...COMMISSION_ONLY_PACKS];
}

/** Does this plan sell one specific pack? Legacy-aware, via the rule above. */
export function planSellsPack(
  capabilities: VendorPlanCapabilityInput | null | undefined,
  pack: VendorPermissionPack,
): boolean {
  return packsFromPlanCapabilities(capabilities).includes(pack);
}

/**
 * Which held permissions satisfy a required one — the single implication table.
 * Both `hasVendorPermission` and the admin grid derive from this; two hand-kept
 * copies were how the server and the UI came to disagree (guideline P6).
 *
 * Only WITHIN-pack hierarchy: `view_x` is satisfied by any verb on x, and the
 * discrete verbs are satisfied by the legacy `manage_x`. The old cross-pack
 * aliases (discounts satisfied by product grants, staff by store settings) are
 * deliberately gone — they contradict packs being disjoint, and made the grid
 * lie about effective access.
 */
export const VENDOR_PERMISSION_IMPLICATIONS: Partial<
  Record<VendorPermission, VendorPermission[]>
> = (() => {
  const table: Partial<Record<VendorPermission, VendorPermission[]>> = {};
  const add = (target: VendorPermission, satisfiedBy: VendorPermission[]) => {
    table[target] = Array.from(new Set([target, ...satisfiedBy]));
  };

  const resources: {
    view?: VendorPermission;
    manage?: VendorPermission;
    verbs: VendorPermission[];
  }[] = [
    {
      view: VENDOR_PERMISSIONS.VIEW_PRODUCTS,
      manage: VENDOR_PERMISSIONS.MANAGE_PRODUCTS,
      verbs: [
        VENDOR_PERMISSIONS.CREATE_PRODUCTS,
        VENDOR_PERMISSIONS.EDIT_PRODUCTS,
        VENDOR_PERMISSIONS.DELETE_PRODUCTS,
      ],
    },
    {
      view: VENDOR_PERMISSIONS.VIEW_ORDERS,
      manage: VENDOR_PERMISSIONS.MANAGE_ORDERS,
      verbs: [
        VENDOR_PERMISSIONS.CREATE_ORDERS,
        VENDOR_PERMISSIONS.EDIT_ORDERS,
        VENDOR_PERMISSIONS.DELETE_ORDERS,
      ],
    },
    {
      view: VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
      manage: VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      verbs: [VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS],
    },
    {
      view: VENDOR_PERMISSIONS.VIEW_STAFF,
      manage: VENDOR_PERMISSIONS.MANAGE_STAFF,
      verbs: [
        VENDOR_PERMISSIONS.CREATE_STAFF,
        VENDOR_PERMISSIONS.EDIT_STAFF,
        VENDOR_PERMISSIONS.DELETE_STAFF,
      ],
    },
    {
      // Analytics is read-only for a vendor, so the resource is just its view.
      view: VENDOR_PERMISSIONS.VIEW_ANALYTICS,
      verbs: [],
    },
    {
      view: VENDOR_PERMISSIONS.VIEW_BRANDS,
      verbs: [
        VENDOR_PERMISSIONS.CREATE_BRANDS,
        VENDOR_PERMISSIONS.EDIT_BRANDS,
      ],
    },
    {
      view: VENDOR_PERMISSIONS.VIEW_DISCOUNTS,
      manage: VENDOR_PERMISSIONS.MANAGE_DISCOUNTS,
      verbs: [
        VENDOR_PERMISSIONS.CREATE_DISCOUNTS,
        VENDOR_PERMISSIONS.EDIT_DISCOUNTS,
        VENDOR_PERMISSIONS.DELETE_DISCOUNTS,
      ],
    },
    {
      // See a balance, or request a withdrawal. There is no third verb.
      view: VENDOR_PERMISSIONS.VIEW_PAYOUTS,
      manage: VENDOR_PERMISSIONS.MANAGE_PAYOUTS,
      verbs: [],
    },
    {
      // POS is a single access grant: what a seat may do inside the till is
      // governed by STAFF_PERMISSIONS, which keeps its own verbs.
      view: VENDOR_PERMISSIONS.ACCESS_POS,
      verbs: [],
    },
  ];

  // Strictly one-directional: only a BROADER holding satisfies a narrower
  // requirement. `view_x` is the narrowest, so any verb satisfies it; a discrete
  // verb is satisfied by the umbrella above it; and the umbrella is satisfied by
  // nothing but itself.
  //
  // That last part is a deliberate tightening. The old table let `create_x`
  // satisfy a `manage_x` check, which both loosened access and broke the revoke
  // cascade: revoking the umbrella would have dragged down every verb under it,
  // including ones an admin had explicitly kept.
  for (const resource of resources) {
    const all = [
      ...(resource.manage ? [resource.manage] : []),
      ...resource.verbs,
    ];
    if (resource.view) add(resource.view, all);
    if (resource.manage) add(resource.manage, []);
    for (const verb of resource.verbs) {
      add(verb, resource.manage ? [resource.manage] : []);
    }
  }

  // Messaging: viewing is satisfied by replying or managing; replying by
  // managing. Channel setup stands alone.
  add(VENDOR_PERMISSIONS.VIEW_INBOX, [
    VENDOR_PERMISSIONS.REPLY_INBOX,
    VENDOR_PERMISSIONS.MANAGE_INBOX,
  ]);
  add(VENDOR_PERMISSIONS.REPLY_INBOX, [VENDOR_PERMISSIONS.MANAGE_INBOX]);
  add(VENDOR_PERMISSIONS.MANAGE_INBOX, []);
  add(VENDOR_PERMISSIONS.MANAGE_CHANNELS, []);

  // Boosts follow the discounts shape: viewing is satisfied by managing.
  add(VENDOR_PERMISSIONS.VIEW_BOOSTS, [VENDOR_PERMISSIONS.MANAGE_BOOSTS]);
  add(VENDOR_PERMISSIONS.MANAGE_BOOSTS, []);

  // AI Studio is a single access grant — it satisfies only itself.
  add(VENDOR_PERMISSIONS.ACCESS_AI_STUDIO, []);

  return table;
})();

/**
 * Expand explicit revokes to everything that would otherwise satisfy them.
 *
 * Without this a revoke is decorative: revoking `delete_products` while the
 * vendor still holds the legacy umbrella `manage_products` leaves the delete
 * guard passing, because the implication table says manage satisfies delete.
 * The admin would have unchecked a box that did nothing — the exact "checkbox
 * that lies" failure the layered model exists to remove.
 *
 * The rule falls straight out of the table: the ways to satisfy `p` are
 * `VENDOR_PERMISSION_IMPLICATIONS[p]`, so revoking `p` must drop all of them.
 * Revoking a narrow verb therefore also drops the umbrella above it, and
 * revoking `view_x` drops the whole resource — you cannot edit what you cannot
 * see. The discrete verbs stay individually granted, so nothing else is lost.
 *
 * This mirrors what the previous admin grid already did by hand when an action
 * checkbox was touched (it stripped `legacyManage`); the difference is that it
 * now happens where the decision is made instead of in one UI.
 */
export function cascadeVendorRevokes(
  explicitRevokes: Iterable<VendorPermission>,
): Set<VendorPermission> {
  const out = new Set<VendorPermission>();
  for (const revoked of explicitRevokes) {
    out.add(revoked);
    for (const satisfier of VENDOR_PERMISSION_IMPLICATIONS[revoked] ?? []) {
      out.add(satisfier);
    }
  }
  return out;
}

/**
 * MARKETPLACE POLICY — one switch per capability pack.
 *
 * Policy is the outermost of the four layers: a platform-wide kill switch for
 * what any vendor may do here. It is deliberately one-to-one with packs, so a
 * toggle can never reach further than its label says.
 *
 * It did not start that way. Eight `multiVendorMode.can*` booleans covered
 * eleven packs, so "Manage Store Settings" silently carried Staff and the
 * Inbox with it — problem P5 in the guideline. That mapping is kept below only
 * to read stores that predate the split.
 */
export type VendorPackPolicy = Record<VendorPermissionPack, boolean>;

/** The legacy eight, still the shape stored on rows written before the split. */
export interface VendorPolicyFlags {
  canManageProducts: boolean;
  canViewOrders: boolean;
  canManageOrders: boolean;
  canManageStoreSettings: boolean;
  canViewAnalytics: boolean;
  canManageDiscounts: boolean;
  canManagePayouts: boolean;
  canAccessPOS: boolean;
}

/**
 * Which legacy boolean used to govern each pack — the fallback that makes the
 * split a no-op on deploy. A store with no `packPolicy` yet is read through
 * this, so every vendor keeps exactly the access they have until an operator
 * changes a switch or the migration writes the values down.
 *
 * Orders is the one lossy entry: it used to sit under TWO booleans
 * (`canViewOrders` for the list, `canManageOrders` for everything else), which
 * made a marketplace-wide "vendors may look but not touch" possible. One switch
 * per pack cannot express that. The fallback keeps the pack ON when either half
 * was on — the reading that never takes access away on deploy — and the
 * migration reports any store where the two disagreed, so its operator can
 * re-create the intent with a per-vendor revoke of `manage_orders`.
 */
export const LEGACY_POLICY_FLAG_OF_PACK: Record<
  VendorPermissionPack,
  (keyof VendorPolicyFlags)[]
> = {
  catalog: ["canManageProducts"],
  aiStudio: ["canManageProducts"],
  orders: ["canViewOrders", "canManageOrders"],
  storefront: ["canManageStoreSettings"],
  staff: ["canManageStoreSettings"],
  inbox: ["canManageStoreSettings"],
  analytics: ["canViewAnalytics"],
  discounts: ["canManageDiscounts"],
  boosts: ["canManageDiscounts"],
  payouts: ["canManagePayouts"],
  pos: ["canAccessPOS"],
};

// ============================================
// Staff Permissions (for seller/staff role)
// ============================================

export const STAFF_PERMISSIONS = {
  // POS
  ACCESS_POS: "access_pos",
  MANAGE_POS: "manage_pos",
  CREATE_POS: "create_pos",
  EDIT_POS: "edit_pos",
  DELETE_POS: "delete_pos",

  // Orders
  VIEW_ORDERS: "view_orders",
  MANAGE_ORDERS: "manage_orders",
  CREATE_ORDERS: "create_orders",
  EDIT_ORDERS: "edit_orders",
  DELETE_ORDERS: "delete_orders",

  // Products
  VIEW_PRODUCTS: "view_products",
  MANAGE_PRODUCTS: "manage_products",
  CREATE_PRODUCTS: "create_products",
  EDIT_PRODUCTS: "edit_products",
  DELETE_PRODUCTS: "delete_products",

  // Customers
  VIEW_CUSTOMERS: "view_customers",
  MANAGE_CUSTOMERS: "manage_customers",
  CREATE_CUSTOMERS: "create_customers",
  EDIT_CUSTOMERS: "edit_customers",
  DELETE_CUSTOMERS: "delete_customers",

  // Inventory
  VIEW_INVENTORY: "view_inventory",
  MANAGE_INVENTORY: "manage_inventory",
  CREATE_INVENTORY: "create_inventory",
  EDIT_INVENTORY: "edit_inventory",
  DELETE_INVENTORY: "delete_inventory",

  // Reviews
  VIEW_REVIEWS: "view_reviews",
  MANAGE_REVIEWS: "manage_reviews",
  EDIT_REVIEWS: "edit_reviews",
  DELETE_REVIEWS: "delete_reviews",

  // Analytics (view-only)
  VIEW_ANALYTICS: "view_analytics",

  // Vendor omnichannel inbox
  VIEW_INBOX: "view_inbox",
  REPLY_INBOX: "reply_inbox",
  MANAGE_INBOX: "manage_inbox",
} as const;

export type StaffPermission =
  (typeof STAFF_PERMISSIONS)[keyof typeof STAFF_PERMISSIONS];

// Default staff permissions (new staff get these)
export const DEFAULT_STAFF_PERMISSIONS: StaffPermission[] = [
  STAFF_PERMISSIONS.ACCESS_POS,
  STAFF_PERMISSIONS.VIEW_ORDERS,
  STAFF_PERMISSIONS.VIEW_PRODUCTS,
  STAFF_PERMISSIONS.VIEW_CUSTOMERS,
  STAFF_PERMISSIONS.VIEW_INBOX,
  STAFF_PERMISSIONS.REPLY_INBOX,
];

// All staff permissions
export const ALL_STAFF_PERMISSIONS = Object.values(STAFF_PERMISSIONS);

/**
 * Permission presets — starting points for common staff jobs.
 *
 * Deliberately NOT roles: a preset only pre-fills the permission checkboxes in
 * the team form, and the admin adjusts from there. Making these roles would
 * mean a second access system next to the per-permission grants that every
 * guard already reads.
 */
interface StaffPermissionPreset {
  key: string;
  label: string;
  description: string;
  permissions: StaffPermission[];
}

export const STAFF_PERMISSION_PRESETS: StaffPermissionPreset[] = [
  {
    key: "store-manager",
    label: "Store Manager",
    description: "Runs the floor — everything except deleting records",
    permissions: [
      STAFF_PERMISSIONS.ACCESS_POS,
      STAFF_PERMISSIONS.CREATE_POS,
      STAFF_PERMISSIONS.EDIT_POS,
      STAFF_PERMISSIONS.VIEW_ORDERS,
      STAFF_PERMISSIONS.CREATE_ORDERS,
      STAFF_PERMISSIONS.EDIT_ORDERS,
      STAFF_PERMISSIONS.VIEW_PRODUCTS,
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.EDIT_PRODUCTS,
      STAFF_PERMISSIONS.VIEW_CUSTOMERS,
      STAFF_PERMISSIONS.CREATE_CUSTOMERS,
      STAFF_PERMISSIONS.EDIT_CUSTOMERS,
      STAFF_PERMISSIONS.VIEW_INVENTORY,
      STAFF_PERMISSIONS.CREATE_INVENTORY,
      STAFF_PERMISSIONS.EDIT_INVENTORY,
      STAFF_PERMISSIONS.VIEW_REVIEWS,
      STAFF_PERMISSIONS.EDIT_REVIEWS,
      STAFF_PERMISSIONS.VIEW_ANALYTICS,
      STAFF_PERMISSIONS.VIEW_INBOX,
      STAFF_PERMISSIONS.REPLY_INBOX,
      STAFF_PERMISSIONS.MANAGE_INBOX,
    ],
  },
  {
    key: "sales-associate",
    label: "Sales Associate",
    description: "Sells at the counter and looks up orders and customers",
    permissions: [
      STAFF_PERMISSIONS.ACCESS_POS,
      STAFF_PERMISSIONS.CREATE_POS,
      STAFF_PERMISSIONS.VIEW_ORDERS,
      STAFF_PERMISSIONS.CREATE_ORDERS,
      STAFF_PERMISSIONS.VIEW_PRODUCTS,
      STAFF_PERMISSIONS.VIEW_CUSTOMERS,
      STAFF_PERMISSIONS.CREATE_CUSTOMERS,
    ],
  },
  {
    key: "cashier",
    label: "Cashier",
    description: "Rings up sales at the POS terminal, nothing else",
    permissions: [
      STAFF_PERMISSIONS.ACCESS_POS,
      STAFF_PERMISSIONS.CREATE_POS,
      STAFF_PERMISSIONS.VIEW_PRODUCTS,
    ],
  },
  {
    key: "support-agent",
    label: "Support Agent",
    description: "Answers the inbox and checks orders and customers",
    permissions: [
      STAFF_PERMISSIONS.VIEW_INBOX,
      STAFF_PERMISSIONS.REPLY_INBOX,
      STAFF_PERMISSIONS.VIEW_ORDERS,
      STAFF_PERMISSIONS.VIEW_CUSTOMERS,
    ],
  },
];
