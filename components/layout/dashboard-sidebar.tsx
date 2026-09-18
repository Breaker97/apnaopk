"use client";

import Link from "next/link";
import * as React from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import {
  ListOrdered,
  LayoutDashboard,
  Users,
  Store,
  Package,
  Tags,
  Tag,
  ShoppingCart,
  Settings,
  BarChart,
  BarChart3,
  SearchX,
  ChevronRight,
  Home,
  ClipboardList,
  Layers,
  Warehouse,
  FileBox,
  ArrowLeftRight,
  Gift,
  Megaphone,
  Percent,
  FileText,
  Globe,
  PlusCircle,
  ArrowLeft,
  MapPin,
  UserCog,
  CreditCard,
  HandCoins,
  MessageSquare,
  Newspaper,
  ListTree,
  Bot,
  CalendarClock,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Rocket,
  Receipt,
  Landmark,
  GalleryHorizontalEnd,
  LayoutGrid,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAppSettings, presetColors } from "@/stores/app-settings";
import {
  useMultiVendorMode,
  useAppSettings as usePublicAppSettings,
} from "@/providers/app-settings-provider";
import { USER_ROLES } from "@/config/app.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { AppImage } from "@/components/ui/app-image";
import { useAppTheme } from "@/providers/theme-provider";
import { useInboxUnreadCount } from "@/hooks/use-inbox-unread-count";
import { SidebarCountBadge } from "@/components/layout/sidebar-count-badge";

// Icon mapping
const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  PanelsTopLeft,
  ListOrdered,
  Users,
  Store,
  Package,
  Tags,
  Tag,
  ShoppingCart,
  Settings,
  BarChart,
  BarChart3,
  SearchX,
  Home,
  ClipboardList,
  Layers,
  Warehouse,
  FileBox,
  ArrowLeftRight,
  Gift,
  Megaphone,
  Percent,
  FileText,
  Globe,
  PlusCircle,
  ArrowLeft,
  MapPin,
  UserCog,
  CreditCard,
  HandCoins,
  MessageSquare,
  Newspaper,
  ListTree,
  Bot,
  CalendarClock,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Rocket,
  Receipt,
  Landmark,
  GalleryHorizontalEnd,
  LayoutGrid,
};

/**
 * The sidebar shown beside a POS sub-page.
 *
 * Built per area rather than declared once, because `DashboardSidebar` is
 * mounted by BOTH the admin and the vendor layout. A single `/admin/*` list
 * meant a vendor was offered admin links, and `app/[locale]/admin/layout.tsx`
 * requires `isAdmin` — so following one bounced them to the login page from
 * inside their own dashboard.
 *
 * Not currently reachable for vendors: the POS terminal itself renders no
 * sidebar, and `/vendor/pos/locations` now redirects out of the POS tree, so
 * there is no `/vendor/pos/*` sub-page left to land on. It is built correctly
 * anyway — the wrongness was latent, not absent, and the next vendor POS
 * sub-page would have brought it straight back.
 */
type DashboardArea = "admin" | "vendor";

function dashboardAreaFromPath(basePath: string): DashboardArea {
  return basePath === "/vendor" || basePath.startsWith("/vendor/")
    ? "vendor"
    : "admin";
}

function buildPosNavItems(area: DashboardArea): NavItem[] {
  if (area === "vendor") {
    return [
      { label: "pos.newSale", href: "/vendor/pos", icon: "ShoppingCart" },
      {
        label: "admin.sidebar.orders",
        href: "/vendor/orders",
        icon: "ClipboardList",
      },
      // A vendor's staff are managed outside POS — there is no
      // `/vendor/pos/staff` to point at, and the admin path would bounce them.
      { label: "admin.sidebar.staff", href: "/vendor/staff", icon: "Users" },
      { label: "locations.title", href: "/vendor/locations", icon: "MapPin" },
    ];
  }

  return [
    { label: "pos.newSale", href: "/admin/pos", icon: "ShoppingCart" },
    {
      label: "admin.sidebar.orders",
      href: "/admin/orders",
      icon: "ClipboardList",
    },
    {
      label: "admin.sidebar.posStaff",
      href: "/admin/pos/staff",
      icon: "Users",
    },
    {
      // The canonical screen, not the `/admin/pos/locations` redirect that used
      // to live here — locations are no longer a POS-only concern.
      label: "admin.sidebar.posLocations",
      href: "/admin/locations",
      icon: "MapPin",
    },
  ];
}

/** Live counts a nav entry can carry as a badge. Only top-level leaf entries render one. */
type NavCountKey = "inboxUnread";

interface NavItem {
  label: string;
  href: string;
  icon: string;
  items?: NavItem[];
  countKey?: NavCountKey;
}

interface DashboardSidebarProps {
  locale: string;
  user: {
    name: string;
    email: string;
    image?: string;
    role: string;
  };
  vendorPermissions?: string[];
}

const adminNavGroups: {
  label: string;
  items: NavItem[];
  collapsible?: boolean;
}[] = [
  {
    label: "",
    items: [
      // ── Overview ──────────────────────────────
      {
        label: "admin.sidebar.overview",
        href: "/admin/dashboard",
        icon: "LayoutDashboard",
      },
            // ── Measure ───────────────────────────────
      {
        label: "admin.sidebar.analytics",
        href: "/admin/analytics",
        icon: "BarChart3",
        // An index child plus a deeper sibling, the same shape as Vendors:
        // the sibling's longer href wins, so only one entry lights up.
        items: [
          {
            label: "admin.sidebar.traffic",
            href: "/admin/analytics",
            icon: "BarChart3",
          },
          {
            label: "admin.sidebar.searchInsights",
            href: "/admin/analytics/search",
            icon: "SearchX",
          },
        ],
      },
      // ── Sell (daily operations) ───────────────
      {
        label: "admin.sidebar.orders",
        href: "/admin/orders",
        icon: "ClipboardList",
        items: [
          {
            label: "admin.sidebar.allOrders",
            href: "/admin/orders",
            icon: "ClipboardList",
          },
          {
            label: "admin.sidebar.preorders",
            href: "/admin/preorders",
            icon: "CalendarClock",
          },
          {
            label: "admin.sidebar.returns",
            href: "/admin/returns",
            icon: "ArrowLeftRight",
          },
          // Pre-sale, so it sits with the order queue rather than under
          // Products: a quote request is a lead being worked, not a catalogue
          // record being edited.
          {
            label: "admin.sidebar.quotes",
            href: "/admin/quotes",
            icon: "FileText",
          },
          {
            label: "admin.sidebar.abandonedCheckouts",
            href: "/admin/abandoned-checkouts",
            icon: "ShoppingCart",
          },
        ],
      },
      {
        label: "admin.sidebar.products",
        href: "/admin/products",
        icon: "Package",
        items: [
          {
            label: "admin.sidebar.allProducts",
            href: "/admin/products",
            icon: "Package",
          },
          {
            label: "admin.sidebar.globalVariants",
            href: "/admin/global-variants",
            icon: "SlidersHorizontal",
          },
          {
            label: "admin.sidebar.collections",
            href: "/admin/collections",
            icon: "Layers",
          },
          {
            label: "admin.sidebar.categories",
            href: "/admin/categories",
            icon: "Tags",
          },
          {
            label: "admin.sidebar.brands",
            href: "/admin/brands",
            icon: "Tag",
          },
          {
            label: "admin.sidebar.inventory",
            href: "/admin/inventory",
            icon: "Warehouse",
          },
          // Between Inventory and Transfers on purpose: Transfers moves stock
          // *between* these, so the thing being moved and the places it moves
          // between read in order.
          {
            label: "locations.title",
            href: "/admin/locations",
            icon: "MapPin",
          },
          // {
          //   label: "admin.sidebar.purchaseOrders",
          //   href: "/admin/purchase-orders",
          //   icon: "FileBox",
          // },
          {
            label: "admin.sidebar.transfers",
            href: "/admin/transfers",
            icon: "ArrowLeftRight",
          },
          {
            label: "admin.sidebar.reviews",
            href: "/admin/reviews",
            icon: "MessageSquare",
          },
          // {
          //   label: "admin.sidebar.giftCards",
          //   href: "/admin/gift-cards",
          //   icon: "Gift",
          // },
        ],
      },
      {
        label: "admin.sidebar.aiStudio",
        href: "/admin/ai-studio",
        icon: "Sparkles",
      },
       {
        label: "admin.sidebar.aiSalesAgent",
        href: "/admin/ai-sales-agent",
        icon: "Bot",
      },
      // ── People ────────────────────────────────
      {
        label: "admin.sidebar.customers",
        href: "/admin/customers",
        icon: "Users",
      },
      {
        label: "admin.sidebar.vendors",
        href: "/admin/vendors",
        icon: "Store",
        items: [
          {
            label: "admin.sidebar.vendors",
            href: "/admin/vendors",
            icon: "Store",
          },
          {
            label: "admin.sidebar.vendorPlans",
            href: "/admin/vendors/plans",
            icon: "Layers",
          },
          {
            label: "admin.sidebar.vendorConfiguration",
            href: "/admin/vendors/configuration",
            icon: "SlidersHorizontal",
          },
          {
            label: "admin.sidebar.vendorOnboarding",
            href: "/admin/vendors/onboarding",
            icon: "ClipboardList",
          },
          {
            label: "admin.sidebar.accessRequests",
            href: "/admin/access-requests",
            icon: "ShieldCheck",
          },
        ],
      },
      {
        label: "admin.sidebar.staff",
        href: "/admin/staff",
        icon: "UserCog",
      },
      // ── Money ─────────────────────────────────
      // "Payments" answered "did this charge go through". "Finance" answers
      // "how is the business doing", which is a different question and takes
      // different screens — so the group is renamed and Overview leads it.
      {
        label: "admin.sidebar.finance",
        href: "/admin/finance",
        icon: "Landmark",
        items: [
          {
            label: "admin.sidebar.financeOverview",
            href: "/admin/finance",
            icon: "Landmark",
          },
          {
            label: "admin.sidebar.expenses",
            href: "/admin/finance/expenses",
            icon: "Receipt",
          },
          {
            label: "admin.sidebar.payouts",
            href: "/admin/payouts",
            icon: "HandCoins",
          },
          {
            label: "admin.sidebar.receivables",
            href: "/admin/finance/receivables",
            icon: "ArrowLeftRight",
          },
          {
            label: "admin.sidebar.payments",
            href: "/admin/payments",
            icon: "CreditCard",
          },
          {
            label: "admin.sidebar.transactions",
            href: "/admin/payments/transactions",
            icon: "CreditCard",
          },
          {
            label: "admin.sidebar.financeReports",
            href: "/admin/finance/reports",
            icon: "FileText",
          },
        ],
      },
      // ── Grow (sales-driving tools) ────────────
      // {
      //   label: "admin.sidebar.marketing",
      //   href: "/admin/marketing",
      //   icon: "Megaphone",
      // },
      {
        label: "admin.sidebar.discounts",
        href: "/admin/discounts",
        icon: "Percent",
      },
      {
        label: "admin.sidebar.boosts",
        href: "/admin/boosts",
        icon: "Rocket",
        items: [
          {
            label: "admin.sidebar.boostCampaigns",
            href: "/admin/boosts",
            icon: "Rocket",
          },
          {
            label: "admin.sidebar.boostPositions",
            href: "/admin/boosts/positions",
            icon: "ListOrdered",
          },
        ],
      },
     
      // ── Engage ────────────────────────────────
      {
        label: "admin.sidebar.content",
        href: "/admin/content/blog-posts",
        icon: "FileText",
        items: [
          {
            label: "admin.sidebar.blogPosts",
            href: "/admin/content/blog-posts",
            icon: "Newspaper",
          },
        ],
      },
      {
        label: "admin.sidebar.inbox",
        href: "/admin/inbox",
        icon: "MessageSquare",
        countKey: "inboxUnread",
      },
      // {
      //   label: "admin.sidebar.markets",
      //   href: "/admin/markets",
      //   icon: "Globe",
      // }
    ],
  },
  {
    label: "admin.sidebar.salesChannels",
    collapsible: true,
    items: [
      {
        label: "admin.sidebar.onlineStore",
        href: "/admin/online-store",
        icon: "Store",
        items: [
          // Customize first: the daily-driver editor. Every storefront
          // template lives INSIDE it (switcher), never as its own item.
          {
            label: "admin.sidebar.customize",
            href: "/admin/online-store/customize",
            icon: "PanelsTopLeft",
          },
          {
            label: "admin.sidebar.themes",
            href: "/admin/online-store/theme",
            icon: "Layers",
          },
          {
            label: "admin.sidebar.pages",
            href: "/admin/online-store/pages",
            icon: "FileText",
          },
          {
            label: "admin.sidebar.navigation",
            href: "/admin/online-store/menus",
            icon: "ListTree",
          },
          {
            label: "admin.sidebar.sliders",
            href: "/admin/online-store/sliders",
            icon: "GalleryHorizontalEnd",
          },
          {
            label: "admin.sidebar.checkout",
            href: "/admin/online-store/checkout",
            icon: "CreditCard",
          },
          // The store-wide card design plus the catalogue's out-of-stock
          // policy — a dedicated editor like Checkout, so it gets its own
          // entry; templates still live only inside Customize.
          {
            label: "admin.sidebar.productCard",
            href: "/admin/online-store/product-card",
            icon: "LayoutGrid",
          },
        ],
      },
      {
        label: "admin.sidebar.pos",
        href: "/admin/pos",
        icon: "ShoppingCart",
      },
    ],
  },
];

function buildVendorNavGroups(
  permissions: string[] | undefined,
  posEnabled: boolean,
  vendorPlansEnabled: boolean,
): { label: string; items: NavItem[] }[] {
  const perms = new Set(permissions || []);
  const items: NavItem[] = [
    {
      label: "vendor.dashboard",
      href: "/vendor/dashboard",
      icon: "LayoutDashboard",
    },
  ];

  {
    const hasProductAccess =
      perms.has("view_products") ||
      perms.has("manage_products") ||
      perms.has("create_products") ||
      perms.has("edit_products") ||
      perms.has("delete_products");
    const hasBrandAccess = perms.has("view_brands");

    if (hasProductAccess || hasBrandAccess) {
      const productItems: NavItem[] = [];

      if (hasProductAccess) {
        productItems.push(
          {
            label: "admin.sidebar.allProducts",
            href: "/vendor/products",
            icon: "Package",
          },
          {
            label: "admin.sidebar.inventory",
            href: "/vendor/inventory",
            icon: "Warehouse",
          },
          // Next to Inventory rather than under POS: the two are read together
          // (the inventory list filters by location, the product form stocks
          // by it), and burying this under the register is what left vendors
          // with the register switched off unable to find it at all.
          {
            label: "locations.title",
            href: "/vendor/locations",
            icon: "MapPin",
          },
          // Moving stock between those locations, as the admin nav places it.
          {
            label: "admin.sidebar.transfers",
            href: "/vendor/transfers",
            icon: "ArrowLeftRight",
          },
        );
      }

      if (hasBrandAccess) {
        productItems.push({
          label: "admin.sidebar.brands",
          href: "/vendor/brands",
          icon: "Tag",
        });
      }

      items.push({
        label: "vendor.products",
        href: productItems[0].href,
        icon: "Package",
        items: productItems,
      });
    }
  }

  if (
    perms.has("view_orders") ||
    perms.has("manage_orders") ||
    perms.has("create_orders") ||
    perms.has("edit_orders") ||
    perms.has("delete_orders")
  ) {
    items.push({
      label: "vendor.orders",
      href: "/vendor/orders",
      icon: "ShoppingCart",
      items: [
        {
          label: "admin.sidebar.allOrders",
          href: "/vendor/orders",
          icon: "ClipboardList",
        },
        {
          label: "admin.sidebar.preorders",
          href: "/vendor/preorders",
          icon: "CalendarClock",
        },
        {
          label: "admin.sidebar.returns",
          href: "/vendor/returns",
          icon: "ArrowLeftRight",
        },
      ],
    });
    // Derived entirely from the vendor's own orders (registered and guest
    // buyers alike), so it shares the order-viewing gate rather than needing
    // a permission of its own.
    items.push({
      label: "admin.sidebar.customers",
      href: "/vendor/customers",
      icon: "Users",
    });
  }

  if (
    perms.has("view_payouts") ||
    perms.has("manage_payouts") ||
    perms.has("create_payouts") ||
    perms.has("edit_payouts") ||
    perms.has("delete_payouts")
  ) {
    // One group rather than two flat entries: a payout is the end of a story
    // the other screens tell, and a vendor asking "why is this the number"
    // should find the answer next to it rather than somewhere else in the nav.
    items.push({
      label: "vendor.finance",
      href: "/vendor/finance",
      icon: "Landmark",
      items: [
        {
          label: "admin.sidebar.financeOverview",
          href: "/vendor/finance",
          icon: "Landmark",
        },
        {
          label: "vendor.statements",
          href: "/vendor/finance/statements",
          icon: "FileText",
        },
        {
          label: "admin.sidebar.expenses",
          href: "/vendor/finance/expenses",
          icon: "Receipt",
        },
        {
          label: "vendor.payouts",
          href: "/vendor/payouts",
          icon: "HandCoins",
        },
        {
          label: "vendor.owedToPlatform",
          href: "/vendor/finance/owed",
          icon: "ArrowLeftRight",
        },
      ],
    });
  }

  if (
    perms.has("view_inbox") ||
    perms.has("reply_inbox") ||
    perms.has("manage_inbox")
  ) {
    items.push({
      label: "admin.sidebar.inbox",
      href: "/vendor/inbox",
      icon: "MessageSquare",
      countKey: "inboxUnread",
    });
  }

  if (
    perms.has("view_discounts") ||
    perms.has("manage_discounts") ||
    perms.has("create_discounts") ||
    perms.has("edit_discounts") ||
    perms.has("delete_discounts") ||
    perms.has("manage_products") ||
    perms.has("create_products") ||
    perms.has("edit_products") ||
    perms.has("delete_products")
  ) {
    items.push({
      label: "admin.sidebar.discounts",
      href: "/vendor/discounts",
      icon: "Percent",
    });
  }

  if (perms.has("view_boosts") || perms.has("manage_boosts")) {
    items.push({
      label: "vendor.boosts",
      href: "/vendor/boosts",
      icon: "Rocket",
    });
  }

  // Gated on the store-settings permissions the billing page itself requires,
  // so the entry is never offered to someone the page would bounce: a plan
  // sets the commission rate and the product/staff ceilings, which makes it
  // the concern of whoever configures the store rather than whoever
  // reconciles its payouts.
  if (
    vendorPlansEnabled &&
    (perms.has("view_store_settings") ||
      perms.has("manage_store_settings") ||
      perms.has("edit_store_settings"))
  ) {
    items.push({
      label: "vendor.planBilling",
      href: "/vendor/billing",
      icon: "CreditCard",
    });
  }

  if (
    perms.has("view_staff") ||
    perms.has("manage_staff") ||
    perms.has("create_staff") ||
    perms.has("edit_staff") ||
    perms.has("delete_staff") ||
    perms.has("manage_store_settings")
  ) {
    items.push({
      label: "admin.sidebar.staff",
      href: "/vendor/staff",
      icon: "UserCog",
    });
  }

  if (posEnabled && perms.has("access_pos")) {
    items.push({
      label: "admin.sidebar.pos",
      href: "/vendor/pos",
      icon: "ShoppingCart",
    });
  }

  return [{ label: "", items }];
}

function filterNavGroupsByHref<T extends { items: NavItem[] }>(
  groups: T[],
  blockedHrefs: Set<string>,
): T[] {
  return groups.map((group) => ({
    ...group,
    items: filterNavItemsByHref(group.items, blockedHrefs),
  }));
}

function filterNavItemsByHref(
  items: NavItem[],
  blockedHrefs: Set<string>,
): NavItem[] {
  return items
    .filter((item) => !blockedHrefs.has(item.href))
    .map((item) => ({
      ...item,
      items: item.items
        ? filterNavItemsByHref(item.items, blockedHrefs)
        : undefined,
    }));
}

// Determine whether `href` is the active nav target for the current path.
// Exact matches always win. A prefix match (basePath nested under href) only
// counts when no sibling href is a longer, more specific match — this prevents
// an "index" child (whose href is a prefix of its siblings, e.g. /admin/vendors)
// from lighting up alongside the deeper sibling that actually matches
// (e.g. /admin/vendors/onboarding).
function isNavHrefActive(
  basePath: string,
  href: string,
  siblingHrefs: string[],
): boolean {
  if (basePath === href) return true;
  if (!basePath.startsWith(`${href}/`)) return false;
  return !siblingHrefs.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      (basePath === other || basePath.startsWith(`${other}/`)),
  );
}

// Every sidebar link is `prefetch={false}` on purpose. The tree holds 50–90
// links, and Next 16's viewport prefetch rendered a `/_tree` partial for each
// of them on every dashboard page view — more server work than the page
// itself. A click now pays one round trip instead (with `false`, Next 16 does
// not prefetch on hover either).
function CollapsedHoverSubmenu({
  item,
  submenuItems,
  Icon,
  isActive,
  isApparent,
  isRTL,
  basePath,
  tLabel,
}: {
  item: NavItem;
  submenuItems: NavItem[];
  Icon: LucideIcon;
  isActive: boolean;
  isApparent: boolean;
  isRTL: boolean;
  basePath: string;
  tLabel: (key: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  React.useEffect(() => () => cancelClose(), [cancelClose]);

  return (
    <SidebarMenuItem
      className="group-data-[collapsible=icon]:w-full"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="sm"
            isActive={isActive}
            className={cn(
              "relative rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors w-full justify-center group/btn cursor-pointer",
              "group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5 group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-1.5",
              isApparent
                ? isActive
                  ? "bg-white/20 text-white hover:bg-white/25 font-semibold"
                  : "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                : isActive
                  ? "bg-primary/10 text-primary hover:bg-primary/10 dark:bg-white/15 dark:text-white dark:hover:bg-white/20 font-semibold"
                  : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
            )}
          >
            <Icon className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-3.5 group-data-[collapsible=icon]:-translate-x-1" />
            <ChevronRight
              className={cn(
                "absolute top-2.5 h-2.5 w-2.5 opacity-70",
                isRTL ? "left-2 rotate-180" : "right-2",
                isApparent
                  ? "text-white/70"
                  : isActive
                    ? "text-sidebar-accent-foreground"
                    : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "hidden text-[10px] leading-tight group-data-[collapsible=icon]:block text-center wrap-break-word whitespace-normal overflow-visible",
                isApparent
                  ? "text-white"
                  : isActive
                    ? "text-sidebar-accent-foreground"
                    : "text-muted-foreground",
              )}
            >
              {tLabel(item.label)}
            </span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={isRTL ? "left" : "right"}
          align="start"
          sideOffset={10}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="w-56 p-2 rounded-2xl shadow-xl border-border/50 bg-popover/95 backdrop-blur-sm"
        >
          {submenuItems.map((child) => {
            const isChildItemActive = isNavHrefActive(
              basePath,
              child.href,
              submenuItems.map((c) => c.href),
            );
            return (
              <DropdownMenuItem
                key={child.href}
                asChild
                className="p-0 mb-0.5 last:mb-0 focus:bg-transparent"
              >
                <Link
                  prefetch={false}
                  href={child.href}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 rounded-xl cursor-pointer transition-colors",
                    isChildItemActive
                      ? "bg-muted text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="text-sm">{tLabel(child.label)}</span>
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function DashboardSidebar({
  locale,
  user,
  vendorPermissions,
}: DashboardSidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const basePath = React.useMemo(() => {
    const prefix = `/${locale}`;
    if (pathname?.startsWith(prefix)) {
      const stripped = pathname.slice(prefix.length);
      return stripped.length ? stripped : "/";
    }
    return pathname;
  }, [pathname, locale]);
  const { navColor, presetColor, primaryColor, rtl } = useAppSettings();
  const { isMultiVendor } = useMultiVendorMode();
  const {
    storeName,
    logoUrl,
    darkModeLogoUrl,
    faviconUrl,
    posEnabled,
    boostingEnabled,
    vendorPlansEnabled,
  } = usePublicAppSettings();
  const { isDark } = useAppTheme();
  const { state: sidebarState, isMobile } = useSidebar();
  const tLabel = React.useCallback(
    (key: string) => {
      if (!key.includes(".")) return key;
      try {
        return t(key as never);
      } catch {
        return key;
      }
    },
    [t],
  );

  // Detect if we're on a POS page
  const isPosTerminal =
    basePath === "/admin/pos" ||
    basePath === "/vendor/pos" ||
    basePath === "/staff/pos";
  const isPosPage =
    isPosTerminal ||
    basePath.startsWith("/admin/pos/") ||
    basePath.startsWith("/vendor/pos/") ||
    basePath.startsWith("/staff/pos/");

  // Keyed off the path, not the role: an admin browsing the vendor area must
  // still be offered the vendor links they are actually looking at.
  const posNavItems = React.useMemo(
    () => buildPosNavItems(dashboardAreaFromPath(basePath)),
    [basePath],
  );

  const navGroups = React.useMemo(() => {
    // Only two areas mount this component — `app/[locale]/admin/layout.tsx`
    // (which requires `isAdmin`) and `app/[locale]/vendor/layout.tsx`. Staff get
    // `components/staff/staff-sidebar.tsx` instead, so the staff arm that used
    // to sit here was unreachable, and its `/admin/*` hrefs would have bounced
    // a staff user to login had anything ever rendered them.
    const baseGroups =
      user.role === USER_ROLES.ADMIN
        ? adminNavGroups
        : buildVendorNavGroups(
            vendorPermissions,
            Boolean(posEnabled),
            Boolean(vendorPlansEnabled),
          );

    let nextGroups = baseGroups;

    if (!isMultiVendor && user.role === USER_ROLES.ADMIN) {
      nextGroups = filterNavGroupsByHref(
        nextGroups,
        new Set(["/admin/vendors", "/admin/payouts"]),
      );
    }

    if (!isMultiVendor && user.role === USER_ROLES.VENDOR) {
      nextGroups = filterNavGroupsByHref(
        nextGroups,
        new Set(["/vendor/preorders"]),
      );
    }

    if (!boostingEnabled) {
      nextGroups = filterNavGroupsByHref(
        nextGroups,
        new Set(["/vendor/boosts", "/admin/boosts"]),
      );
    }

    if (user.role === USER_ROLES.ADMIN && !posEnabled) {
      nextGroups = nextGroups.map((group) => {
        if (group.label === "admin.sidebar.salesChannels") {
          return {
            ...group,
            items: group.items.filter((item) => item.href !== "/admin/pos"),
          };
        }
        return group;
      });
    }

    return nextGroups;
  }, [
    user.role,
    isMultiVendor,
    posEnabled,
    boostingEnabled,
    vendorPlansEnabled,
    vendorPermissions,
  ]);

  // Polled only when Inbox is actually in the nav: a vendor without inbox
  // access would be answered 403 on every tick.
  const hasInboxEntry = navGroups.some((group) =>
    group.items.some((item) => item.countKey === "inboxUnread"),
  );
  const inboxUnread = useInboxUnreadCount(hasInboxEntry && !isPosPage);
  const navCounts: Record<NavCountKey, number> = { inboxUnread };

  // RTL detection based on locale OR manual setting
  const isRTL = locale === "ar" || rtl; // Arabic locale or manual RTL toggle
  const sidebarSide = isRTL ? "right" : "left";

  // Force collapsed behavior to minimize (icon rail)
  const collapsible = "icon";
  const isIconCollapsed =
    !isMobile && collapsible === "icon" && sidebarState === "collapsed";

  // Determine if using apparent (dark) sidebar
  const isApparent = navColor === "apparent";
  const useDarkSidebarBrand = isDark || isApparent;

  // Get the preset color value for apparent mode (use hex for inline style
  // compatibility). Prefer the live primary color so custom (non-preset) brand
  // colors also drive the apparent sidebar; fall back to the built-in preset
  // hex for legacy documents where primaryColor may be missing.
  const presetColorHex =
    typeof primaryColor === "string" && primaryColor.trim()
      ? primaryColor
      : presetColors[presetColor]?.hex;
  const currentLogoUrl =
    useDarkSidebarBrand &&
    typeof darkModeLogoUrl === "string" &&
    darkModeLogoUrl.trim()
      ? darkModeLogoUrl
      : typeof logoUrl === "string" && logoUrl.trim()
        ? logoUrl
        : "";
  // No bundled icon backs this up — an unconfigured favicon shows the store's
  // initial, never this app's own mark.
  const currentFaviconUrl =
    typeof faviconUrl === "string" && faviconUrl.trim() ? faviconUrl : "";
  const brandStoreName =
    typeof storeName === "string" && storeName.trim()
      ? storeName
      : DEFAULT_STORE_NAME;

  const renderSidebarBrand = () => {
    if (isIconCollapsed) {
      return (
        <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-md">
          {currentFaviconUrl ? (
            <AppImage
              src={currentFaviconUrl}
              alt="Favicon"
              className="h-8 w-8 object-contain"
              width={32}
              height={32}
            />
          ) : (
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold",
                isApparent
                  ? "bg-white/15 text-white"
                  : "bg-primary/10 text-primary",
              )}
            >
              {brandStoreName.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </span>
      );
    }

    if (currentLogoUrl) {
      return (
        <span className="relative block h-8 w-full overflow-hidden">
          <AppImage
            src={currentLogoUrl}
            alt="Logo"
            className="h-8 w-full object-contain object-left"
            width={224}
            height={32}
          />
        </span>
      );
    }

    return (
      <span
        className={cn(
          "block text-lg font-bold truncate",
          isApparent
            ? "text-white"
            : "bg-linear-to-r from-primary to-primary/70 bg-clip-text text-transparent",
        )}
      >
        {brandStoreName}
      </span>
    );
  };

  const initiallyOpenHrefs = React.useMemo(() => {
    const openSet = new Set<string>();
    for (const group of navGroups) {
      for (const item of group.items) {
        const children = item.items;
        if (!children?.length) continue;
        const isSelfActive =
          basePath === item.href || basePath.startsWith(`${item.href}/`);
        const isChildActive = children.some(
          (child) =>
            basePath === child.href || basePath.startsWith(`${child.href}/`),
        );
        if (isSelfActive || isChildActive) openSet.add(item.href);
      }
    }
    return openSet;
  }, [navGroups, basePath]);

  const [openSections, setOpenSections] = React.useState<Set<string>>(
    () => initiallyOpenHrefs,
  );

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setOpenSections(initiallyOpenHrefs);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initiallyOpenHrefs]);

  const toggleSection = React.useCallback((href: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }, []);

  // Removed hover-controlled flyout state to make submenus open on click only
  const canAccessVendorSettings = React.useMemo(() => {
    if (user.role !== USER_ROLES.VENDOR) {
      return false;
    }

    const perms = new Set(vendorPermissions || []);
    return (
      perms.has("view_store_settings") ||
      perms.has("manage_store_settings") ||
      perms.has("create_store_settings") ||
      perms.has("edit_store_settings") ||
      perms.has("delete_store_settings")
    );
  }, [user.role, vendorPermissions]);

  const footerSettings = React.useMemo(() => {
    if (user.role === USER_ROLES.ADMIN) {
      return {
        path: "/admin/settings",
        label: t("common.settings"),
      };
    }

    if (canAccessVendorSettings) {
      return {
        path: "/vendor/settings",
        label: tLabel("vendor.settings"),
      };
    }

    return null;
  }, [user.role, canAccessVendorSettings, t, tLabel]);

  // ============================================
  // POS Terminal — no sidebar (fullscreen)
  // ============================================
  if (isPosTerminal) {
    return null;
  }

  // ============================================
  // POS Sub-pages Sidebar (staff, locations)
  // ============================================
  if (isPosPage) {
    return (
      <Sidebar
        key={`pos-sidebar-${locale}-${sidebarSide}`}
        side={sidebarSide}
        className={cn(
          // Navigation is chrome, not content — keep it out of print output.
          "border-r-0 transition-colors duration-300 print:hidden",
          isRTL && "border-l-0 border-r",
        )}
        style={
          isApparent
            ? ({
                "--sidebar": presetColorHex,
                "--color-sidebar": presetColorHex,
                "--sidebar-foreground": "#ffffff",
                "--color-sidebar-foreground": "#ffffff",
                "--sidebar-accent": "rgb(255 255 255 / 0.2)",
                "--color-sidebar-accent": "rgb(255 255 255 / 0.2)",
                "--sidebar-accent-foreground": "#ffffff",
                "--color-sidebar-accent-foreground": "#ffffff",
              } as React.CSSProperties)
            : undefined
        }
        collapsible={collapsible}
      >
        {!isMobile && (
          <div
            suppressHydrationWarning
            className={`absolute top-0 bottom-0 w-px ${
              isApparent ? "bg-white/30" : "bg-border"
            } z-30 pointer-events-none ${isRTL ? "-left-px" : "-right-px"}`}
          />
        )}
        <SidebarHeader className="border-b-0 px-3 py-3 relative group-data-[collapsible=icon]:px-2">
          <Link
            prefetch={false}
            href={`/${locale}`}
            className="flex w-full items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            {renderSidebarBrand()}
          </Link>
        </SidebarHeader>

        <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:gap-1">
          {/* Back to Admin */}
          <SidebarGroup className="group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-2">
            <SidebarGroupContent>
              <SidebarMenu className="gap-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-3">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    size="sm"
                    className={cn(
                      "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
                      isApparent
                        ? "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                        : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
                    )}
                  >
                    <Link prefetch={false} href="/admin/dashboard" className="relative w-full">
                      <div className="flex items-center gap-3 w-full group-data-[collapsible=icon]:justify-center">
                        <ArrowLeft className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-5" />
                        <span className="group-data-[collapsible=icon]:hidden">
                          {t("common.backToDashboard")}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center",
                          isApparent ? "text-white" : "text-muted-foreground",
                        )}
                      >
                        {t("common.back")}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* POS Navigation */}
          <SidebarGroup className="group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-2">
            <SidebarGroupLabel
              className={cn(
                "px-4 mb-1 text-[11px] font-semibold tracking-[0.08em] group-data-[collapsible=icon]:hidden uppercase",
                isApparent ? "text-white/60" : "text-muted-foreground/60",
              )}
            >
              {t("admin.sidebar.pos")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-3">
                {posNavItems.map((item) => {
                  const Icon = iconMap[item.icon] || Package;
                  // The register's own href, whichever area we are in. It was
                  // hardcoded to `/admin/pos`, so in the vendor area nothing
                  // suppressed the prefix match and "New Sale" lit up on every
                  // POS sub-page alongside the item actually open.
                  const posRootHref = posNavItems[0]?.href;
                  const isPosRoot = item.href === posRootHref;
                  const isItemActive = isPosRoot
                    ? // Exact only: every sub-page sits under this href.
                      basePath === item.href
                    : basePath === item.href ||
                      basePath.startsWith(`${item.href}/`);

                  return (
                    <SidebarMenuItem
                      key={item.href}
                      className="group-data-[collapsible=icon]:w-full"
                    >
                      <SidebarMenuButton
                        asChild
                        size="sm"
                        isActive={isItemActive}
                        className={cn(
                          "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
                          isApparent
                            ? isItemActive
                              ? "bg-white/20 text-white hover:bg-white/25 font-semibold"
                              : "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                            : isItemActive
                              ? "bg-primary/10 text-primary hover:bg-primary/10 dark:bg-white/15 dark:text-white dark:hover:bg-white/20 font-semibold"
                              : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
                        )}
                      >
                        <Link prefetch={false} href={item.href} className="relative w-full">
                          <div className="flex items-center gap-3 w-full group-data-[collapsible=icon]:justify-center">
                            <Icon className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-5" />
                            <span className="group-data-[collapsible=icon]:hidden">
                              {tLabel(item.label)}
                            </span>
                          </div>
                          <span
                            className={cn(
                              "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center",
                              isApparent
                                ? "text-white"
                                : isItemActive
                                  ? "text-sidebar-accent-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {tLabel(item.label)}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-2 mt-auto">
          <SidebarMenu className="group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="sm"
                className={cn(
                  "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
                  isApparent
                    ? "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                    : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
                )}
              >
                <Link
                  prefetch={false}
                  href="/admin/settings"
                  className="relative py-4 flex items-center gap-3 w-full group-data-[collapsible=icon]:justify-center"
                >
                  <Settings className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:mr-0 group-data-[collapsible=icon]:size-5" />
                  <span className="flex-1 group-data-[collapsible=icon]:hidden">
                    {t("common.settings")}
                  </span>
                  <span
                    className={cn(
                      "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center",
                      isApparent ? "text-white" : "text-muted-foreground",
                    )}
                  >
                    {t("common.settings")}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }

  // ============================================
  // Default Admin/Vendor Sidebar
  // ============================================
  return (
    <Sidebar
      key={`dashboard-sidebar-${locale}-${sidebarSide}`}
      side={sidebarSide}
      className={cn(
        "border-r-0 transition-colors duration-300",
        isRTL && "border-l-0 border-r",
      )}
      style={
        isApparent
          ? ({
              "--sidebar": presetColorHex,
              "--color-sidebar": presetColorHex,
              "--sidebar-foreground": "#ffffff",
              "--color-sidebar-foreground": "#ffffff",
              "--sidebar-accent": "rgb(255 255 255 / 0.2)",
              "--color-sidebar-accent": "rgb(255 255 255 / 0.2)",
              "--sidebar-accent-foreground": "#ffffff",
              "--color-sidebar-accent-foreground": "#ffffff",
            } as React.CSSProperties)
          : undefined
      }
      collapsible={collapsible}
    >
      {/* Collapse Toggle Button with vertical line - positioned at sidebar level */}
      {!isMobile && (
        <div
          suppressHydrationWarning
          className={`absolute top-0 bottom-0 w-px ${
            isApparent ? "bg-white/30" : "bg-border"
          } z-30 pointer-events-none ${isRTL ? "-left-px" : "-right-px"}`}
        />
      )}
      <SidebarHeader className="border-b-0 px-3 py-3 relative group-data-[collapsible=icon]:px-2">
        <Link
          prefetch={false}
          href={`/${locale}`}
          className="flex w-full items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          {renderSidebarBrand()}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:gap-1">
        {navGroups.map((group, groupIndex) => (
          <SidebarGroup
            key={group.label}
            className={cn(
              groupIndex === 0 ? "mt-0" : "mt-2",
              "group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-2",
            )}
          >
            {group.label && (
              <SidebarGroupLabel
                className={cn(
                  "px-4 mb-1 text-[11px] font-semibold tracking-[0.08em] group-data-[collapsible=icon]:hidden flex items-center uppercase",
                  isApparent ? "text-white/60" : "text-muted-foreground/60",
                )}
              >
                {tLabel(group.label)}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-3">
                {group.items.map((item) => {
                  const Icon = iconMap[item.icon] || Package;
                  // Check if item matches current path (self)
                  const isSelfActive =
                    basePath === item.href ||
                    basePath.startsWith(`${item.href}/`);

                  // Check if any child matches current path
                  const isChildActive = Boolean(
                    item.items?.some(
                      (child) =>
                        basePath === child.href ||
                        basePath.startsWith(`${child.href}/`),
                    ),
                  );

                  const isActive = isSelfActive || isChildActive;

                  if (item.items && item.items.length > 0) {
                    const children = item.items;
                    const childHrefs = children.map((child) => child.href);
                    const isOpen = isChildActive || openSections.has(item.href);
                    const isSectionActive = isActive;
                    const isSectionExpanded = isOpen || isChildActive;

                    if (isIconCollapsed) {
                      return (
                        <CollapsedHoverSubmenu
                          key={item.href}
                          item={item}
                          submenuItems={children}
                          Icon={Icon}
                          isActive={isActive}
                          isApparent={isApparent}
                          isRTL={isRTL}
                          basePath={basePath}
                          tLabel={tLabel}
                        />
                      );
                    }

                    return (
                      <SidebarMenuItem key={item.href} className="mb-0.5">
                        <SidebarMenuButton
                          type="button"
                          size="sm"
                          isActive={isSectionActive}
                          aria-expanded={isOpen}
                          onClick={() => toggleSection(item.href)}
                          className={cn(
                            "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors w-full justify-between group/btn cursor-pointer",
                            isApparent
                              ? isSectionActive
                                ? "bg-white/20 text-white hover:bg-white/25 font-semibold"
                                : isSectionExpanded
                                  ? "bg-white/10 text-white hover:bg-white/15 font-semibold"
                                  : "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                              : isSectionActive
                                ? "bg-primary/10 text-primary hover:bg-primary/10 data-[active=true]:bg-primary/10 data-[active=true]:text-primary dark:bg-white/15 dark:text-white dark:hover:bg-white/20 dark:data-[active=true]:bg-white/15 dark:data-[active=true]:text-white font-semibold"
                                : isSectionExpanded
                                  ? "bg-muted/70 text-foreground hover:bg-muted/80 font-semibold"
                                  : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-5" />
                            <span className="group-data-[collapsible=icon]:hidden">
                              {tLabel(item.label)}
                            </span>
                          </div>
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 transition-transform duration-200 opacity-60 group-data-[collapsible=icon]:hidden",
                              isOpen && "rotate-90 opacity-100",
                            )}
                          />
                        </SidebarMenuButton>

                        {isOpen && (
                          <SidebarMenuSub className="ml-2 mt-1 pl-2.5 border-l-0 relative">
                            {children.map((child, childIndex) => {
                              const childSelfActive = isNavHrefActive(
                                basePath,
                                child.href,
                                childHrefs,
                              );
                              const grandChildren = child.items ?? [];
                              const grandChildHrefs = grandChildren.map(
                                (grandChild) => grandChild.href,
                              );
                              const isGrandChildActive = grandChildren.some(
                                (grandChild) =>
                                  basePath === grandChild.href ||
                                  basePath.startsWith(`${grandChild.href}/`),
                              );
                              const isChildItemActive =
                                childSelfActive || isGrandChildActive;
                              const isChildOpen =
                                childSelfActive ||
                                isGrandChildActive ||
                                openSections.has(child.href);
                              const isChildLeafActive =
                                childSelfActive && !isGrandChildActive;
                              const isLast = childIndex === children.length - 1;

                              return (
                                <React.Fragment key={child.href}>
                                  <SidebarMenuSubItem className="relative h-7 flex items-center pl-4">
                                    {/* Vertical line */}
                                    <div
                                      className={cn(
                                        "absolute left-0 w-px",
                                        isApparent
                                          ? "bg-white/30"
                                          : "bg-muted-foreground/20 dark:bg-white/25",
                                        isLast
                                          ? "top-0 h-3.5"
                                          : "top-0 bottom-0",
                                      )}
                                    />
                                    {/* Horizontal branch */}
                                    <div
                                      className={cn(
                                        "absolute left-0 top-3.5 w-4 h-px",
                                        isApparent
                                          ? "bg-white/30"
                                          : "bg-muted-foreground/20 dark:bg-white/25",
                                      )}
                                    />

                                    {grandChildren.length > 0 ? (
                                      <SidebarMenuSubButton
                                        type="button"
                                        size="sm"
                                        isActive={isChildLeafActive}
                                        aria-expanded={isChildOpen}
                                        onClick={() =>
                                          toggleSection(child.href)
                                        }
                                        className={cn(
                                          "rounded-md px-2 py-1 text-[13px] font-medium relative z-10 w-full justify-between",
                                          isApparent
                                            ? isChildLeafActive
                                              ? "bg-white/20 text-white font-semibold"
                                              : isChildOpen
                                                ? "bg-white/10 text-white font-semibold hover:bg-white/15"
                                                : "text-white/90 hover:bg-white/15 hover:text-white"
                                            : isChildLeafActive
                                              ? "bg-muted text-foreground font-semibold data-[active=true]:bg-muted data-[active=true]:text-foreground"
                                              : isChildOpen
                                                ? "bg-muted/60 text-foreground font-semibold hover:bg-muted/70"
                                                : "text-foreground/60 hover:text-foreground",
                                        )}
                                      >
                                        <span>{tLabel(child.label)}</span>
                                        <ChevronRight
                                          className={cn(
                                            "h-3.5 w-3.5 opacity-70 transition-transform",
                                            isChildOpen &&
                                              "rotate-90 opacity-100",
                                          )}
                                        />
                                      </SidebarMenuSubButton>
                                    ) : (
                                      <SidebarMenuSubButton
                                        asChild
                                        size="sm"
                                        isActive={isChildItemActive}
                                        className={cn(
                                          "rounded-md px-2 py-1 text-[13px] font-medium relative z-10 w-full",
                                          isApparent
                                            ? "text-white/90 hover:bg-white/15 hover:text-white"
                                            : "text-foreground/60 hover:text-foreground",
                                          isChildItemActive &&
                                            (isApparent
                                              ? "bg-white/20 text-white font-semibold"
                                              : "bg-muted text-foreground font-semibold data-[active=true]:bg-muted data-[active=true]:text-foreground"),
                                        )}
                                      >
                                        <Link prefetch={false} href={child.href}>
                                          <span>{tLabel(child.label)}</span>
                                        </Link>
                                      </SidebarMenuSubButton>
                                    )}
                                  </SidebarMenuSubItem>

                                  {grandChildren.length > 0 && isChildOpen && (
                                    <SidebarMenuSub className="ml-4 -mt-0.5 mb-0.5 pl-0 border-l-0">
                                      {grandChildren.map((grandChild) => {
                                        const isGrandChildItemActive =
                                          isNavHrefActive(
                                            basePath,
                                            grandChild.href,
                                            grandChildHrefs,
                                          );

                                        return (
                                          <SidebarMenuSubItem
                                            key={grandChild.href}
                                            className="relative h-7 flex items-center pl-4"
                                          >
                                            <div
                                              className={cn(
                                                "absolute left-0 top-3.5 w-3 h-px",
                                                isApparent
                                                  ? "bg-white/25"
                                                  : "bg-muted-foreground/15 dark:bg-white/20",
                                              )}
                                            />
                                            <SidebarMenuSubButton
                                              asChild
                                              size="sm"
                                              isActive={isGrandChildItemActive}
                                              className={cn(
                                                "rounded-md px-2 py-1 text-[12px] font-medium relative z-10 w-full",
                                                isApparent
                                                  ? "text-white/80 hover:bg-white/15 hover:text-white"
                                                  : "text-foreground/60 hover:text-foreground",
                                                isGrandChildItemActive &&
                                                  (isApparent
                                                    ? "bg-white/20 text-white font-semibold"
                                                    : "bg-muted text-foreground font-semibold data-[active=true]:bg-muted data-[active=true]:text-foreground"),
                                              )}
                                            >
                                              <Link prefetch={false} href={grandChild.href}>
                                                <span>
                                                  {tLabel(grandChild.label)}
                                                </span>
                                              </Link>
                                            </SidebarMenuSubButton>
                                          </SidebarMenuSubItem>
                                        );
                                      })}
                                    </SidebarMenuSub>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </SidebarMenuSub>
                        )}
                      </SidebarMenuItem>
                    );
                  }

                  const count = item.countKey ? navCounts[item.countKey] : 0;

                  return (
                    <SidebarMenuItem
                      key={item.href}
                      className="group-data-[collapsible=icon]:w-full"
                    >
                      <SidebarMenuButton
                        asChild
                        size="sm"
                        isActive={isActive}
                        className={cn(
                          "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
                          isApparent
                            ? isActive
                              ? "bg-white/20 text-white hover:bg-white/25 font-semibold"
                              : "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                            : isActive
                              ? "bg-primary/10 text-primary hover:bg-primary/10 dark:bg-white/15 dark:text-white dark:hover:bg-white/20 font-semibold"
                              : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
                        )}
                      >
                        <Link prefetch={false} href={item.href} className="relative w-full">
                          <div className="flex items-center gap-3 w-full group-data-[collapsible=icon]:justify-center">
                            <span className="relative inline-flex shrink-0">
                              <Icon className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-5" />
                              <SidebarCountBadge
                                count={count}
                                isApparent={isApparent}
                                rail
                              />
                            </span>
                            <span className="group-data-[collapsible=icon]:hidden">
                              {tLabel(item.label)}
                            </span>
                            <SidebarCountBadge
                              count={count}
                              isApparent={isApparent}
                            />
                          </div>
                          <span
                            className={cn(
                              "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center break-words whitespace-normal overflow-visible",
                              isApparent
                                ? "text-white"
                                : isActive
                                  ? "text-sidebar-accent-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {tLabel(item.label)}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {footerSettings && (
        <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-2 mt-auto">
          <SidebarMenu className="group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem className="group-data-[collapsible=icon]:w-full">
              {(() => {
                const settingsPath = footerSettings.path;
                const isSettingsActive =
                  basePath === settingsPath ||
                  basePath.startsWith(`${settingsPath}/`);

                return (
                  <SidebarMenuButton
                    asChild
                    size="sm"
                    isActive={isSettingsActive}
                    className={cn(
                      "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
                      isApparent
                        ? isSettingsActive
                          ? "bg-white/20 text-white hover:bg-white/25 font-semibold"
                          : "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                        : isSettingsActive
                          ? "bg-primary/10 text-primary hover:bg-primary/10 dark:bg-white/15 dark:text-white dark:hover:bg-white/20 font-semibold"
                          : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
                    )}
                  >
                    <Link
                      prefetch={false}
                      href={settingsPath}
                      className="relative py-4 flex items-center gap-3 w-full group-data-[collapsible=icon]:justify-center"
                    >
                      <Settings className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:mr-0 group-data-[collapsible=icon]:size-5" />
                      <span className="flex-1 group-data-[collapsible=icon]:hidden">
                        {footerSettings.label}
                      </span>
                      <span
                        className={cn(
                          "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center break-words whitespace-normal overflow-visible",
                          isApparent
                            ? "text-white"
                            : isSettingsActive
                              ? "text-sidebar-accent-foreground"
                              : "text-muted-foreground",
                        )}
                      >
                        {footerSettings.label}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                );
              })()}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

