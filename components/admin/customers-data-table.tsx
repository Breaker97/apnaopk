"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "@/components/language/link";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import {
  ChevronsUpDown,
  Circle,
  Download,
  Eye,
  Mail,
  MailPlus,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  UserMinus,
  ShieldBan,
  Upload,
} from "lucide-react";
import {
  DataTable,
  CurrencyCell,
  DateCell,
  NumberCell,
  TextCell,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useCsvImportExport } from "@/hooks/use-csv-import-export";
import { CustomerImportDialog } from "@/components/admin/customers/customer-import-dialog";
import { apiClient, type ApiClientError } from "@/lib/api/client";
import { AccountEmailProgress } from "@/components/admin/customers/account-email-progress";
import {
  accountEmailErrorMessage,
  describeSkipped,
  type AccountEmailSkipped,
} from "@/components/admin/customers/account-email-messages";
import { cn } from "@/lib/utils";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import { isLoyaltyEnabled } from "@/lib/customers/loyalty";
import {
  MARKETING_CONSENT_STATE,
  type MarketingConsentState,
} from "@/config/app.config";

interface CustomerListItem {
  _id: string;
  userId: string;
  loyaltyPoints: number;
  loyaltyTier: "bronze" | "silver" | "gold" | "platinum";
  tags?: string[];
  notes?: string;
  acquisitionSource?: string;
  stats?: {
    totalOrders?: number;
    totalSpent?: number;
    averageOrderValue?: number;
    lastOrderDate?: string;
    totalReviews?: number;
    averageRating?: number;
    totalWishlistItems?: number;
  };
  lastActiveAt?: string;
  createdAt: string;
  /** Email marketing consent; absent on rows written before it existed. */
  emailMarketing?: {
    state?: MarketingConsentState;
    consentUpdatedAt?: string;
    source?: string;
  };
  /** The boolean the consent record replaced — still read for unmigrated rows. */
  marketingOptIn?: boolean;
  /** Guest rows: customer records with no account — identity lives on the profile. */
  isGuest?: boolean;
  email?: string;
  name?: string;
  user?: {
    _id: string;
    name: string;
    email: string;
    image?: string;
    phone?: string;
    role: string;
    status?: "active" | "inactive" | "banned";
    createdAt: string;
  };
}

interface CustomersDataTableProps {
  locale: string;
  /**
   * "vendor" renders the read-only storefront-seller variant: no detail
   * links (vendors have no customer detail page), no platform CRM columns
   * (tier, points, tags), and an Export button but no import — the rows' stats
   * are already vendor-scoped by the API. Its filters are Email subscription and
   * Tag.
   */
  area?: "admin" | "staff" | "vendor";
  readOnly?: boolean;
  /**
   * May import customers from a CSV: an admin, or staff who may create
   * customers on the store's side. Never set in the vendor area.
   */
  canImportCustomers?: boolean;
  /**
   * An import may also update the customers it matches: the edit permission,
   * with access to every customer.
   */
  canUpdateOnImport?: boolean;
  /**
   * May send password resets and account invites: an admin, or staff who may
   * edit customers. Never set in the vendor area.
   */
  canSendAccountEmail?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: CustomerListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const CUSTOMER_FILTER_IDS = ["tier", "tag", "subscription"];
/** While loyalty is hidden there is no tier filter for an old `?tier=` to light up. */
const CUSTOMER_FILTER_IDS_WITHOUT_LOYALTY = ["tag", "subscription"];

/** Where each area's tag options and CSV file come from. */
const AREA_ENDPOINTS = {
  admin: {
    tags: "/api/admin/customers/tags",
    export: "/api/admin/customers/import-export",
  },
  vendor: {
    tags: "/api/vendor/customers/tags",
    export: "/api/vendor/customers/export",
  },
} as const;

/**
 * The consent state to show for a row. A profile written before the consent
 * record exists carries only the boolean, and reading those as "not
 * subscribed" would blank out every subscriber a store has until the
 * migration runs.
 */
function readSubscriptionState(row: CustomerListItem): MarketingConsentState {
  return (
    row.emailMarketing?.state ??
    (row.marketingOptIn
      ? MARKETING_CONSENT_STATE.SUBSCRIBED
      : MARKETING_CONSENT_STATE.NOT_SUBSCRIBED)
  );
}

/** The Orders list's badge: 12px, soft fill, square corners. */
const BADGE_CLASS =
  "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium";

const SLATE_BADGE =
  "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200";

const ACCOUNT_STYLES = {
  active:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  inactive:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  banned: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  guest: SLATE_BADGE,
};

const SUBSCRIPTION_STYLES: Record<MarketingConsentState, string> = {
  subscribed:
    "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  pending:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  unsubscribed: SLATE_BADGE,
  not_subscribed: SLATE_BADGE,
  invalid: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  redacted: SLATE_BADGE,
};

const TIER_STYLES = {
  bronze:
    "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
  silver: SLATE_BADGE,
  gold: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  platinum:
    "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
};

function getInitials(name?: string) {
  if (!name) return "CU";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CustomersDataTable({
  locale,
  area = "admin",
  readOnly = false,
  canSendAccountEmail = false,
  canImportCustomers = false,
  canUpdateOnImport = false,
  data,
  pagination,
}: CustomersDataTableProps) {
  const t = useTranslations();
  const tm = useTranslations("admin.customerAccountEmail");
  const tr = useAdminPhrase();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [selectedCustomers, setSelectedCustomers] = useState<CustomerListItem[]>([]);
  const basePath = `/${locale}/${area}`;
  const isVendorArea = area === "vendor";
  // Tier and points hide with the rest of loyalty (see `isLoyaltyEnabled`).
  const loyaltyEnabled = isLoyaltyEnabled();

  const list = useListNavigation<CustomerListItem>({
    items: data,
    pagination,
    filterIds: loyaltyEnabled
      ? CUSTOMER_FILTER_IDS
      : CUSTOMER_FILTER_IDS_WITHOUT_LOYALTY,
  });

  const endpoints = AREA_ENDPOINTS[isVendorArea ? "vendor" : "admin"];

  // Every tag the store uses, not only those on this page: a tag on no
  // visible row is exactly the one an admin needs the filter to find. A
  // seller's rows carry no tags at all, so theirs come from the endpoint too —
  // limited to the people who have bought from them.
  const [storeTags, setStoreTags] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    apiClient
      .get<{ tags: string[] }>(endpoints.tags)
      .then((data) => {
        if (active) setStoreTags(data.tags);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [endpoints.tags]);

  const tagOptions = useMemo(() => {
    const tags = Array.from(
      new Set([
        ...storeTags,
        ...list.items.flatMap((customer) =>
          Array.isArray(customer.tags) ? customer.tags : [],
        ),
      ]),
    ).sort((a, b) => a.localeCompare(b));
    return [
      { label: tr("All", "সব"), value: "all" },
      ...tags.map((tag) => ({ label: tag, value: tag })),
    ];
  }, [list.items, storeTags, tr]);

  // `unsubscribed` stays grey rather than red: leaving a list is a shopper
  // exercising a right, not a fault. Only `invalid` — an address that bounced
  // or reported spam — is an actual problem to fix.
  const subscriptionLabels = useMemo<Record<MarketingConsentState, string>>(
    () => ({
      subscribed: tr("Subscribed", "সাবস্ক্রাইবড"),
      pending: tr("Pending", "নিশ্চিতকরণ বাকি"),
      unsubscribed: tr("Unsubscribed", "আনসাবস্ক্রাইবড"),
      not_subscribed: tr("Not subscribed", "সাবস্ক্রাইব করেনি"),
      invalid: tr("Invalid", "অকার্যকর ঠিকানা"),
      redacted: tr("Redacted", "মুছে ফেলা"),
    }),
    [tr],
  );

  const handleDelete = useCallback(
    async (customer: CustomerListItem) => {
      const confirmed = await confirm({
        title: tr("Delete customer", "গ্রাহক মুছুন"),
        description: t("admin.customersDataTable.deleteSingleDescription", {
          name:
            customer.user?.name ||
            customer.name ||
            customer.email ||
            t("admin.customersDataTable.thisCustomer"),
        }),
        confirmText: tr("Delete", "মুছুন"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/admin/customers/${customer._id}`);
        toast.success(tr("Customer deleted successfully", "গ্রাহক সফলভাবে মুছে ফেলা হয়েছে"));
        list.refetch();
      } catch (error) {
        console.error("Delete customer failed:", error);
        toast.error(tr("Failed to delete customer", "গ্রাহক মুছতে ব্যর্থ"));
      }
    },
    [confirm, list, t, tr],
  );

  const handleBulkDelete = useCallback(
    async (items: CustomerListItem[]) => {
      const confirmed = await confirm({
        title: tr("Delete customers", "গ্রাহকসমূহ মুছুন"),
        description: t("admin.customersDataTable.deleteBulkDescription", {
          count: items.length,
        }),
        confirmText: tr("Delete", "মুছুন"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await Promise.all(
          items.map((item) => apiClient.delete(`/api/admin/customers/${item._id}`)),
        );

        setSelectedCustomers([]);
        toast.success(t("admin.customersDataTable.deleteBulkSuccess", { count: items.length }));
        list.refetch();
      } catch (error) {
        console.error("Bulk delete failed:", error);
        toast.error(tr("Failed to delete some customers", "কিছু গ্রাহক মুছতে ব্যর্থ"));
      }
    },
    [confirm, list, t, tr],
  );

  const handleBulkStatusUpdate = useCallback(
    async (
      items: CustomerListItem[],
      status: NonNullable<NonNullable<CustomerListItem["user"]>["status"]>,
    ) => {
      // Guests have no account to activate, deactivate, or ban — a status
      // update can only ever apply to the rows with a user behind them.
      const accountItems = items.filter((item) => !item.isGuest);
      if (accountItems.length === 0) {
        toast.error(
          tr(
            "Guest customers have no account status",
            "অতিথি গ্রাহকদের অ্যাকাউন্ট স্ট্যাটাস নেই",
          ),
        );
        return;
      }
      const confirmed = await confirm({
        title: tr("Update Account Status", "অ্যাকাউন্ট স্ট্যাটাস আপডেট"),
        description: t("admin.customersDataTable.updateStatusDescription", {
          count: accountItems.length,
          status,
        }),
        confirmText: tr("Update", "আপডেট"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: status === "banned" ? "destructive" : "default",
      });

      if (!confirmed) return;

      const results = await Promise.allSettled(
        accountItems.map((item) =>
          apiClient.put(`/api/admin/customers/${item._id}`, { status }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = accountItems.length - successCount;

      setSelectedCustomers([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(t("admin.customersDataTable.updateSuccess", { count: successCount }));
      }
      if (failCount > 0) {
        toast.error(t("admin.customersDataTable.updateError", { count: failCount }));
      }
    },
    [confirm, list, t, tr],
  );

  /**
   * The list's filter as the server reads it — the URL the page itself was
   * rendered from — for "Send to all N matching". Empty when nothing narrows
   * the list, and then that action is not offered.
   */
  const accountEmailFilter = useMemo(() => {
    const filter: Record<string, string | number> = {};
    if (list.search) filter.search = list.search;
    if (list.activeTab && list.activeTab !== "all") filter.status = list.activeTab;
    const pick = (id: string) => {
      const value = list.filters[id];
      return value && value !== "all" ? value : undefined;
    };
    const tier = loyaltyEnabled ? pick("tier") : undefined;
    if (tier) filter.loyaltyTier = tier;
    const subscription = pick("subscription");
    if (subscription) filter.subscription = subscription;
    const tag = pick("tag");
    if (tag) filter.tag = tag;
    for (const key of ["minSpent", "maxSpent"] as const) {
      const raw = searchParams.get(key);
      const value = raw === null || raw === "" ? NaN : Number(raw);
      if (Number.isFinite(value) && value >= 0) filter[key] = value;
    }
    return filter;
  }, [list.search, list.activeTab, list.filters, loyaltyEnabled, searchParams]);
  const hasAccountEmailFilter = Object.keys(accountEmailFilter).length > 0;

  const [accountEmailRefresh, setAccountEmailRefresh] = useState(0);

  /**
   * Account emails for the ticked rows or everyone matching the filter: a
   * dry run for the count (and who is left out, only when someone is), the
   * confirm dialog, then the queue. The progress line above the table takes
   * it from there.
   */
  const sendAccountEmails = useCallback(
    async (
      selection: { profileIds: string[] } | { filter: Record<string, string | number> },
    ) => {
      let preview: {
        sendable: number;
        skipped: AccountEmailSkipped;
        emailConfigured: boolean;
      };
      try {
        preview = await apiClient.post("/api/admin/customers/account-emails/preview", selection);
      } catch (error) {
        toast.error(accountEmailErrorMessage(error as ApiClientError, tm));
        return;
      }
      if (!preview.emailConfigured) {
        toast.error(tm("emailNotSetUp"));
        return;
      }
      const skippedText = describeSkipped(preview.skipped, tm);
      if (preview.sendable === 0) {
        toast.error([tm("nobodyToSend"), skippedText].filter(Boolean).join(" "));
        return;
      }

      const confirmed = await confirm({
        title: tm("confirmBulkTitle"),
        description: [
          tm("confirmBulkDescription", { count: preview.sendable }),
          skippedText,
        ]
          .filter(Boolean)
          .join(" "),
        confirmText: tm("send"),
        cancelText: tm("cancel"),
      });
      if (!confirmed) return;

      try {
        const result = await apiClient.post<{ batchId: string | null; queued: number }>(
          "/api/admin/customers/account-emails",
          selection,
        );
        setSelectedCustomers([]);
        if (result.queued > 0) {
          toast.success(tm("queued", { count: result.queued }));
          setAccountEmailRefresh((value) => value + 1);
        } else {
          toast.error(tm("nobodyToSend"));
        }
      } catch (error) {
        toast.error(accountEmailErrorMessage(error as ApiClientError, tm));
      }
    },
    [confirm, tm],
  );

  const columns = useMemo<DataTableColumn<CustomerListItem>[]>(
    () => [
      {
        id: "customer",
        header: tr("Customer", "গ্রাহক"),
        cell: (row) => {
          const identity = (
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarImage src={row.user?.image} alt={row.user?.name || row.name || tr("Customer", "গ্রাহক")} />
                <AvatarFallback>{getInitials(row.user?.name || row.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 max-w-[200px]">
                <p className={cn("font-medium truncate", !isVendorArea && "hover:underline")}>{row.user?.name || row.name || tr("Unknown", "অজানা")}</p>
                <p className="text-xs text-muted-foreground truncate">{row.user?.email || row.email}</p>
              </div>
            </div>
          );
          // Vendors have no customer detail page to land on.
          if (isVendorArea) return identity;
          return (
            <Link href={`${basePath}/customers/${row._id}`} className="block">
              {identity}
            </Link>
          );
        },
        className: "w-[240px]",
      },
      {
        id: "accountStatus",
        header: tr("Account", "অ্যাকাউন্ট"),
        cell: (row) => {
          const status = row.isGuest ? "guest" : row.user?.status || "active";
          const labels = {
            active: tr("Active", "সক্রিয়"),
            inactive: tr("Inactive", "নিষ্ক্রিয়"),
            banned: tr("Banned", "নিষিদ্ধ"),
            guest: tr("Guest", "অতিথি"),
          };
          return (
            <span className={`${BADGE_CLASS} ${ACCOUNT_STYLES[status]}`}>
              <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
              {labels[status]}
            </span>
          );
        },
        className: "w-[120px]",
      },
      {
        // Consent as a state, not a tick: "unsubscribed" (they left) and
        // "not subscribed" (never asked) are different facts about a shopper,
        // and a merchant picking who to email needs to see which is which.
        id: "emailSubscription",
        header: tr("Email subscription", "ইমেইল সাবস্ক্রিপশন"),
        cell: (row) => {
          const state = readSubscriptionState(row);
          return (
            // The date sits beside the badge, not under it, so the row
            // stays the Orders list's height.
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`${BADGE_CLASS} shrink-0 ${SUBSCRIPTION_STYLES[state]}`}
              >
                {subscriptionLabels[state]}
              </span>
              {row.emailMarketing?.consentUpdatedAt ? (
                <span className="truncate text-muted-foreground">
                  <DateCell
                    date={row.emailMarketing.consentUpdatedAt}
                    format="relative"
                  />
                </span>
              ) : null}
            </div>
          );
        },
        className: "w-[180px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
      {
        id: "tier",
        header: tr("Loyalty tier", "লয়্যালটি টিয়ার"),
        cell: (row) => {
          const tier = row.loyaltyTier || "bronze";
          const labels = {
            bronze: tr("Bronze", "ব্রোঞ্জ"),
            silver: tr("Silver", "সিলভার"),
            gold: tr("Gold", "গোল্ড"),
            platinum: tr("Platinum", "প্লাটিনাম"),
          };
          return (
            <span className={`${BADGE_CLASS} ${TIER_STYLES[tier]}`}>
              {labels[tier]}
            </span>
          );
        },
        className: "w-[140px]",
      },
      {
        id: "orders",
        header: tr("Orders", "অর্ডার"),
        cell: (row) => <NumberCell value={row.stats?.totalOrders ?? 0} />,
        className: "w-[110px]",
      },
      {
        id: "spent",
        header: tr("Spent", "খরচ"),
        cell: (row) => <CurrencyCell value={row.stats?.totalSpent ?? 0} />,
        className: "w-[140px]",
      },
      {
        id: "lastActive",
        // For vendors the honest timestamp is the last order with THEM —
        // platform-wide activity is none of their business.
        header: isVendorArea
          ? tr("Last order", "সর্বশেষ অর্ডার")
          : tr("Last active", "সর্বশেষ সক্রিয়"),
        cell: (row) =>
          isVendorArea ? (
            row.stats?.lastOrderDate ? (
              <DateCell date={row.stats.lastOrderDate} format="relative" />
            ) : (
              <span className="text-muted-foreground">-</span>
            )
          ) : (
            <DateCell date={row.lastActiveAt || row.createdAt} format="relative" />
          ),
        className: "w-[130px]",
      },
      {
        id: "points",
        header: tr("Points", "পয়েন্ট"),
        cell: (row) => <NumberCell value={row.loyaltyPoints ?? 0} />,
        className: "w-[110px] hidden 2xl:table-cell",
        headerClassName: "hidden 2xl:table-cell",
      },
      {
        id: "tags",
        header: tr("Tags", "ট্যাগ"),
        cell: (row) => (
          <TextCell
            value={row.tags?.length ? row.tags.slice(0, 2).join(", ") : tr("-", "-")}
            truncate
            maxWidth="140px"
          />
        ),
        // Points and tags are the least-read columns, so they go first on a
        // narrower screen.
        className: "w-[160px] hidden 2xl:table-cell",
        headerClassName: "hidden 2xl:table-cell",
      },
    ],
    [tr, isVendorArea, basePath, subscriptionLabels],
  );

  // Loyalty tier, points, and tags are platform CRM — the vendor list's API
  // doesn't even return them. While loyalty is hidden, tier and points go
  // for everyone else too.
  const visibleColumns = useMemo(() => {
    const hidden = isVendorArea
      ? ["tier", "points", "tags"]
      : loyaltyEnabled
        ? []
        : ["tier", "points"];
    return hidden.length
      ? columns.filter((column) => !hidden.includes(column.id))
      : columns;
  }, [columns, isVendorArea, loyaltyEnabled]);

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: tr("All", "সব") },
      { id: "active", label: tr("Active", "সক্রিয়") },
      { id: "inactive", label: tr("Inactive", "নিষ্ক্রিয়") },
      { id: "banned", label: tr("Banned", "নিষিদ্ধ") },
      { id: "guest", label: tr("Guest", "অতিথি") },
    ],
    [tr],
  );

  const filters = useMemo<DataTableFilter[]>(() => {
    const tierFilter: DataTableFilter = {
      id: "tier",
      label: tr("Tier", "টিয়ার"),
      type: "select",
      options: [
        { label: tr("All", "সব"), value: "all" },
        { label: tr("Bronze", "ব্রোঞ্জ"), value: "bronze" },
        { label: tr("Silver", "সিলভার"), value: "silver" },
        { label: tr("Gold", "গোল্ড"), value: "gold" },
        { label: tr("Platinum", "প্লাটিনাম"), value: "platinum" },
      ],
    };
    return [
      // Loyalty is the store's programme, not a seller's.
      ...(loyaltyEnabled && !isVendorArea ? [tierFilter] : []),
      {
        id: "subscription",
        label: tr("Email subscription", "ইমেইল সাবস্ক্রিপশন"),
        type: "select",
        options: [
          { label: tr("All", "সব"), value: "all" },
          { label: tr("Subscribed", "সাবস্ক্রাইবড"), value: "subscribed" },
          { label: tr("Pending", "নিশ্চিতকরণ বাকি"), value: "pending" },
          {
            label: tr("Unsubscribed", "আনসাবস্ক্রাইবড"),
            value: "unsubscribed",
          },
          {
            label: tr("Not subscribed", "সাবস্ক্রাইব করেনি"),
            value: "not_subscribed",
          },
          { label: tr("Invalid", "অকার্যকর ঠিকানা"), value: "invalid" },
        ],
      },
      {
        id: "tag",
        label: tr("Tag", "ট্যাগ"),
        type: "select",
        options: tagOptions,
      },
    ];
  }, [isVendorArea, loyaltyEnabled, tr, tagOptions]);

  const ti = useTranslations("admin.customerImport");
  const [importOpen, setImportOpen] = useState(false);
  /**
   * Every customer the list's filters match, not just the page on screen: the
   * route builds the file from this page's own query, in the import
   * template's columns, so the file can be edited and imported back. With the
   * Email subscription filter on, it is the subscriber list a merchant is
   * actually asking for.
   */
  const { exportCsv, isExporting } = useCsvImportExport({
    endpoint: endpoints.export,
    noun: "customers",
    onImported: list.refetch,
    messages: {
      exporting: ti("export.preparing"),
      exported: ti("export.done"),
      exportFailed: ti("export.failed"),
    },
  });

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: tr("Customers", "গ্রাহক"),
        addAction: readOnly
          ? undefined
          : {
              id: "add",
              label: tr("Add customer", "গ্রাহক যোগ করুন"),
              href: `${basePath}/customers/new`,
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
            },
        // Customers arrive by signing up or checking out — and, for a store
        // moving from another platform, by file: Import reads a CSV (its own
        // template, or a Shopify or WooCommerce export) with a preview first.
        // Without the permission to create customers — and always for a
        // seller, whose customers are the store's — Export is the one button.
        importExportAction:
          canImportCustomers && !isVendorArea
            ? {
                id: "import-export",
                label: t("admin.productsDataTable.actions.importExport"),
                icon: <ChevronsUpDown className="h-4 w-4" />,
                variant: "outline",
                items: [
                  {
                    id: "toolbar-export",
                    label: tr("Export", "এক্সপোর্ট"),
                    icon: <Download className="h-4 w-4" />,
                    onClick: () => void exportCsv(),
                  },
                  {
                    id: "toolbar-import",
                    label: t("admin.productsDataTable.actions.import"),
                    icon: <Upload className="h-4 w-4" />,
                    onClick: () => setImportOpen(true),
                  },
                ],
              }
            : {
                id: "toolbar-export",
                label: tr("Export", "এক্সপোর্ট"),
                icon: <Download className="h-4 w-4" />,
                variant: "outline",
                onClick: () => void exportCsv(),
                disabled: isExporting,
              },
      }),
    [
      tr,
      t,
      readOnly,
      basePath,
      isVendorArea,
      canImportCustomers,
      exportCsv,
      isExporting,
    ],
  );

  const accountEmailActions = useMemo<DataTableBulkAction<CustomerListItem>[]>(
    () =>
      !canSendAccountEmail || isVendorArea
        ? []
        : [
            {
              id: "account-email",
              label: tm("bulkAction"),
              icon: <Mail className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) =>
                sendAccountEmails({ profileIds: items.map((item) => item._id) }),
            },
            // Shopify's "select all N": offered once the rows on screen are a
            // filter's, and sent to everyone it matches — rebuilt on the server.
            ...(hasAccountEmailFilter
              ? [
                  {
                    id: "account-email-all",
                    label: tm("sendToAllMatching", { count: pagination.total }),
                    icon: <MailPlus className="h-4 w-4" />,
                    variant: "outline" as const,
                    onClick: () => sendAccountEmails({ filter: accountEmailFilter }),
                  },
                ]
              : []),
          ],
    [
      accountEmailFilter,
      canSendAccountEmail,
      hasAccountEmailFilter,
      isVendorArea,
      pagination.total,
      sendAccountEmails,
      tm,
    ],
  );

  const bulkActions = useMemo<DataTableBulkAction<CustomerListItem>[]>(
    () =>
      readOnly
        ? accountEmailActions
        : [
            ...accountEmailActions,
            {
              id: "set-active",
              label: tr("Set active", "সক্রিয় করুন"),
              icon: <UserCheck className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkStatusUpdate(items, "active"),
            },
            {
              id: "set-inactive",
              label: tr("Set inactive", "নিষ্ক্রিয় করুন"),
              icon: <UserMinus className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkStatusUpdate(items, "inactive"),
            },
            {
              id: "set-banned",
              label: tr("Set banned", "নিষিদ্ধ করুন"),
              icon: <ShieldBan className="h-4 w-4" />,
              variant: "destructive",
              onClick: (items) => handleBulkStatusUpdate(items, "banned"),
            },
            {
              id: "delete",
              label: tr("Delete", "মুছুন"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: handleBulkDelete,
            },
          ],
    [accountEmailActions, handleBulkDelete, handleBulkStatusUpdate, readOnly, tr],
  );

  const rowActions = useCallback(
    (row: CustomerListItem): DataTableAction[] =>
      isVendorArea
        ? []
        : readOnly
        ? [
            {
              id: "view",
              label: tr("View details", "বিস্তারিত দেখুন"),
              icon: <Eye className="h-4 w-4" />,
              href: `${basePath}/customers/${row._id}`,
            },
          ]
        : [
            {
              id: "view",
              label: tr("View details", "বিস্তারিত দেখুন"),
              icon: <Eye className="h-4 w-4" />,
              href: `${basePath}/customers/${row._id}`,
            },
            {
              id: "edit",
              label: tr("Edit", "এডিট"),
              icon: <Pencil className="h-4 w-4" />,
              href: `${basePath}/customers/${row._id}`,
            },
            {
              id: "delete",
              label: tr("Delete", "মুছুন"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: () => handleDelete(row),
            },
          ],
    [isVendorArea, readOnly, tr, basePath, handleDelete],
  );

  return (
    <>
      {canSendAccountEmail && !isVendorArea ? (
        <AccountEmailProgress refreshKey={accountEmailRefresh} />
      ) : null}
      <DataTable
        data={list.items}
        columns={visibleColumns}
        keyField="_id"
        isLoading={list.isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        actions={tableHeader.actions}
        selectable={!isVendorArea}
        selectedItems={selectedCustomers}
        onSelectionChange={setSelectedCustomers}
        bulkActions={bulkActions}
        searchable
        searchPlaceholder={tr("Search by name or email", "নাম বা ইমেইল দিয়ে খুঁজুন")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={list.filters}
        onFilterChange={list.handleFilterChange}
        toolbarActions={tableHeader.toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        rowActions={rowActions}
        rowActionsHeader={tr("Actions", "অ্যাকশন")}
        rowActionsVariant="dropdown"
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-xs"
        onRowClick={(row) => router.push(`${basePath}/customers/${row._id}`)}
        emptyMessage={tr("No customers found", "কোনো গ্রাহক পাওয়া যায়নি")}
      />
      {canImportCustomers && !isVendorArea ? (
        <CustomerImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          canUpdate={canUpdateOnImport}
          onImported={list.refetch}
        />
      ) : null}
    </>
  );
}
