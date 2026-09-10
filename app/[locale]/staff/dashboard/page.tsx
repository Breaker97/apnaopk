import { setRequestLocale, getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { CustomerProfile, Order, Product, getSettings } from "@/models";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { PRODUCT_STATUS } from "@/config/app.config";
import {
  buildStaffOrderScopeFilter,
  buildStaffProductScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import {
  StaffDashboardContent,
  type StaffPosSale,
  type StaffPosStats,
  type StaffQuickLink,
  type StaffRecentOrder,
} from "@/components/staff/staff-dashboard-content";

interface PageProps {
  params: Promise<{ locale: string }>;
}

interface OrderAggregate {
  totalOrders: number;
  openOrders: number;
  paidRevenue: number;
}

interface StaffPosActivity {
  stats: StaffPosStats;
  recentSales: StaffPosSale[];
}

async function getOrderStatsForStaff(
  staffScope?: StaffAccessScope,
): Promise<OrderAggregate> {
  await connectDB();

  const [result] = await Order.aggregate([
    { $match: buildStaffOrderScopeFilter(staffScope) },
    {
      $facet: {
        totalOrders: [{ $count: "count" }],
        openOrders: [
          { $match: { status: { $nin: ["delivered", "cancelled"] } } },
          { $count: "count" },
        ],
        paidRevenue: [
          { $match: { paymentStatus: "paid" } },
          { $group: { _id: null, total: { $sum: "$total" } } },
        ],
      },
    },
  ]);

  return {
    totalOrders: result?.totalOrders?.[0]?.count || 0,
    openOrders: result?.openOrders?.[0]?.count || 0,
    paidRevenue: result?.paidRevenue?.[0]?.total || 0,
  };
}

async function getProductStatsForStaff(staffScope?: StaffAccessScope): Promise<{
  totalProducts: number;
  lowStockProducts: number;
}> {
  await connectDB();
  const productScope = buildStaffProductScopeFilter(staffScope);

  const [totalProducts, lowStockProducts] = await Promise.all([
    Product.countDocuments(
      mergeScopeFilter({ status: { $ne: PRODUCT_STATUS.UNLISTED } }, productScope),
    ),
    Product.countDocuments(mergeScopeFilter({ stock: { $lte: 5 } }, productScope)),
  ]);

  return { totalProducts, lowStockProducts };
}

async function getCustomerCountForStaff(staffScope?: StaffAccessScope): Promise<number> {
  await connectDB();
  if (hasStaffScope(staffScope)) {
    const customerIds = await Order.distinct(
      "customerId",
      buildStaffOrderScopeFilter(staffScope),
    );
    return customerIds.length;
  }
  return CustomerProfile.countDocuments({});
}

async function getRecentOrdersForStaff(
  staffScope?: StaffAccessScope,
): Promise<StaffRecentOrder[]> {
  await connectDB();

  const orders = await Order.find(buildStaffOrderScopeFilter(staffScope))
    .sort({ createdAt: -1 })
    .limit(5)
    .select(
      "orderNumber customerId total status paymentStatus items createdAt",
    )
    .populate("customerId", "name email")
    .lean<
      Array<{
        _id: unknown;
        orderNumber?: string;
        customerId?: { name?: string; email?: string } | null;
        total?: number;
        status?: string;
        paymentStatus?: string;
        createdAt?: Date | string;
        items?: Array<{
          name?: string;
          image?: string;
          quantity?: number;
        }>;
      }>
    >();

  return orders.map((order) => {
    const items = order.items || [];
    const totalItems = items.reduce(
      (sum, item) => sum + (item.quantity || 0),
      0,
    );
    const primary = items[0];
    const createdAtIso =
      order.createdAt instanceof Date
        ? order.createdAt.toISOString()
        : typeof order.createdAt === "string"
          ? order.createdAt
          : new Date().toISOString();

    return {
      _id: String(order._id ?? ""),
      orderNumber: order.orderNumber || "",
      customerName: order.customerId?.name,
      total: typeof order.total === "number" ? order.total : 0,
      status: order.status || "pending",
      paymentStatus: order.paymentStatus,
      createdAt: createdAtIso,
      itemsCount: totalItems,
      primaryImage: primary?.image,
      primaryName: primary?.name,
    };
  });
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function itemQuantityTotal(items?: Array<{ quantity?: number }>) {
  return (items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
}

async function getPosActivityForStaff(
  staffId: string,
): Promise<StaffPosActivity> {
  await connectDB();

  type PosOrderRow = {
    _id: unknown;
    orderNumber?: string;
    total?: number;
    paymentMethod?: string;
    status?: string;
    createdAt?: Date | string;
    items?: Array<{ quantity?: number }>;
  };

  const [todaysOrders, recentSales] = await Promise.all([
    Order.find({
      channel: "pos",
      staffId,
      createdAt: { $gte: startOfToday() },
    })
      .select("total items")
      .lean<Array<Pick<PosOrderRow, "total" | "items">>>(),
    Order.find({ channel: "pos", staffId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("orderNumber total paymentMethod status createdAt items")
      .lean<PosOrderRow[]>(),
  ]);

  const salesToday = todaysOrders.length;
  const revenueToday = todaysOrders.reduce(
    (sum, order) => sum + (order.total || 0),
    0,
  );
  const itemsSoldToday = todaysOrders.reduce(
    (sum, order) => sum + itemQuantityTotal(order.items),
    0,
  );

  return {
    stats: {
      salesToday,
      revenueToday,
      itemsSoldToday,
      averageSale: salesToday > 0 ? revenueToday / salesToday : 0,
    },
    recentSales: recentSales.map((order) => {
      const createdAtIso =
        order.createdAt instanceof Date
          ? order.createdAt.toISOString()
          : typeof order.createdAt === "string"
            ? order.createdAt
            : new Date().toISOString();

      return {
        _id: String(order._id ?? ""),
        orderNumber: order.orderNumber || "",
        total: typeof order.total === "number" ? order.total : 0,
        paymentMethod: order.paymentMethod || "pos",
        status: order.status || "delivered",
        createdAt: createdAtIso,
        itemsCount: itemQuantityTotal(order.items),
      };
    }),
  };
}

export default async function StaffDashboardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  const tf = (key: string, fallback: string) => {
    return t.has(key as never) ? t(key as never) : fallback;
  };

  const { session, staffPermissions, staffScope } = await requireStaffAreaAccess({
    locale,
  });
  await connectDB();
  const settings = await getSettings();
  const posEnabled = Boolean(
    settings.pos?.enabled && settings.pos.allowSellerSales,
  );

  const canViewOrders = staffPermissions.includes(
    STAFF_PERMISSIONS.VIEW_ORDERS,
  );
  const canViewProducts = staffPermissions.includes(
    STAFF_PERMISSIONS.VIEW_PRODUCTS,
  );
  const canViewCustomers = staffPermissions.includes(
    STAFF_PERMISSIONS.VIEW_CUSTOMERS,
  );
  const canViewInventory = staffPermissions.includes(
    STAFF_PERMISSIONS.VIEW_INVENTORY,
  );
  const canViewAnalytics = staffPermissions.includes(
    STAFF_PERMISSIONS.VIEW_ANALYTICS,
  );
  const canAccessPos =
    posEnabled && staffPermissions.includes(STAFF_PERMISSIONS.ACCESS_POS);

  const [orderStats, productStats, customerCount, recentOrders, posActivity] =
    await Promise.all([
      canViewOrders
        ? getOrderStatsForStaff(staffScope)
        : Promise.resolve(undefined),
      canViewProducts
        ? getProductStatsForStaff(staffScope)
        : Promise.resolve(undefined),
      canViewCustomers
        ? getCustomerCountForStaff(staffScope)
        : Promise.resolve(undefined),
      canViewOrders
        ? getRecentOrdersForStaff(staffScope)
        : Promise.resolve([] as StaffRecentOrder[]),
      canAccessPos
        ? getPosActivityForStaff(session.user.id)
        : Promise.resolve(undefined),
    ]);

  const quickLinks: StaffQuickLink[] = [];

  if (canAccessPos) {
    quickLinks.push({
      key: "pos",
      href: `/${locale}/staff/pos`,
      icon: "pos",
      accent: "green",
      title: tf("admin.sidebar.pos", "Point of Sale"),
      description: tf("pos.newSale", "Start a new sale"),
    });
  }

  if (canViewOrders) {
    quickLinks.push({
      key: "orders",
      href: `/${locale}/staff/orders`,
      icon: "orders",
      accent: "blue",
      title: tf("admin.sidebar.orders", "Orders"),
      description: tf(
        "admin.ordersPage.stats.openOrders.description",
        "Manage open and recent orders",
      ),
    });
  }

  if (canViewProducts) {
    quickLinks.push({
      key: "products",
      href: `/${locale}/staff/products`,
      icon: "products",
      accent: "amber",
      title: tf("admin.sidebar.products", "Products"),
      description: tf(
        "admin.productsPage.stats.totalProducts.description",
        "Browse and update catalog",
      ),
    });
  }

  if (canViewInventory) {
    quickLinks.push({
      key: "inventory",
      href: `/${locale}/staff/inventory`,
      icon: "inventory",
      accent: "violet",
      title: tf("admin.sidebar.inventory", "Inventory"),
      description: tf(
        "admin.productsPage.stats.inventoryUnits.description",
        "Stock counts and adjustments",
      ),
    });
  }

  if (canViewCustomers) {
    quickLinks.push({
      key: "customers",
      href: `/${locale}/staff/customers`,
      icon: "customers",
      accent: "cyan",
      title: tf("admin.sidebar.customers", "Customers"),
      description: tf(
        "admin.customersPage.stats.totalCustomers.description",
        "Customer directory and profiles",
      ),
    });
  }

  if (canViewAnalytics) {
    quickLinks.push({
      key: "analytics",
      href: `/${locale}/staff/analytics`,
      icon: "analytics",
      accent: "rose",
      title: tf("admin.sidebar.analytics", "Analytics"),
      description: tf(
        "admin.dashboardPage.visitorsSubtitle",
        "Performance and traffic insights",
      ),
    });
  }

  const stats = {
    totalOrders: orderStats?.totalOrders,
    openOrders: orderStats?.openOrders,
    paidRevenue: orderStats?.paidRevenue,
    totalProducts: productStats?.totalProducts,
    lowStockProducts: productStats?.lowStockProducts,
    totalCustomers: canViewCustomers ? customerCount : undefined,
  };

  const hasAnyStat = Object.values(stats).some(
    (value) => typeof value === "number",
  );

  const userName =
    session.user.name?.split(" ")[0] ||
    session.user.email?.split("@")[0] ||
    "";

  return (
    <StaffDashboardContent
      locale={locale}
      userName={userName}
      greeting={tf("admin.staffDashboardPage.title", "Staff Dashboard")}
      subtitle={tf(
        "admin.staffDashboardPage.subtitle",
        quickLinks.length === 0
          ? "You don't have access to any staff modules yet. Contact an admin to assign permissions."
          : "Quick access to assigned modules",
      )}
      stats={stats}
      posStats={posActivity?.stats}
      posRecentSales={posActivity?.recentSales}
      recentOrders={recentOrders}
      quickLinks={quickLinks}
      showPosActivity={canAccessPos}
      showRecentOrders={canViewOrders}
      showStats={hasAnyStat}
    />
  );
}
