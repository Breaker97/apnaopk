import { Suspense } from "react";
import { BadgeCheck, Shield, Users, UserX } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { User, StaffProfile } from "@/models";
import { connectDB } from "@/lib/db";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { StaffTableSection } from "@/components/admin/staff-table-section";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { STAFF_USER_ROLES } from "@/lib/access/staff-role";
import { VENDOR_OWNED_STAFF_FILTER } from "@/lib/access/staff-ownership";
import { VendorFeatureLocked } from "@/components/vendor/vendor-feature-locked";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface StaffStats {
  totalStaff: number;
  activeStaff: number;
  inactiveStaff: number;
  posAccess: number;
}

export default async function VendorStaffPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  const t = await getTranslations({ locale });
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.VIEW_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
    ],
  });
  // Staff management stays locked until the subscription is paid. During the
  // setup window the vendor can still reach this page via manage_store_settings,
  // so show the locked state instead of letting the guard throw.
  if (access.accessMode === "setup") {
    return (
      <VendorFeatureLocked
        locale={locale}
        title={t("vendor.featureLocked.staff.title")}
        description={t("vendor.featureLocked.staff.description")}
        paymentDueAt={
          access.paymentApplication?.paymentDueAt?.toISOString() ?? null
        }
        suggestions={[
          {
            href: `/${locale}/vendor/products`,
            title: t("vendor.featureLocked.suggestions.products.title"),
            description: t(
              "vendor.featureLocked.suggestions.products.description",
            ),
          },
          {
            href: `/${locale}/vendor/settings`,
            title: t("vendor.featureLocked.suggestions.settings.title"),
            description: t(
              "vendor.featureLocked.suggestions.settings.description",
            ),
          },
        ]}
      />
    );
  }

  const vendor = await requireApprovedVendorByUserId(access.session.user.id);

  const stats = await getVendorStaffStats(String(vendor._id));

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("admin.staffPage.stats.totalStaff.title"),
      value: stats.totalStaff,
      description: t("admin.staffPage.stats.totalStaff.description"),
      icon: <Users className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.staffPage.stats.activeStaff.title"),
      value: stats.activeStaff,
      description: t("admin.staffPage.stats.activeStaff.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.staffPage.stats.withPosAccess.title"),
      value: stats.posAccess,
      description: t("admin.staffPage.stats.withPosAccess.description"),
      icon: <Shield className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: t("admin.staffPage.stats.inactiveStaff.title"),
      value: stats.inactiveStaff,
      description: t("admin.staffPage.stats.inactiveStaff.description"),
      icon: <UserX className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={5} tabs={4} thumbnail />
        }
      >
        <StaffTableSection
          locale={locale}
          area="vendor"
          searchParams={search}
          vendorId={vendor._id}
        />
      </Suspense>
    </div>
  );
}

async function getVendorStaffStats(vendorId: string): Promise<StaffStats> {
  await connectDB();

  // Ownership, not just membership — platform staff an admin scoped to this
  // vendor's data must not inflate the vendor's stats (the list below already
  // excludes them).
  const profiles = await StaffProfile.find({
    vendorIds: vendorId,
    ...VENDOR_OWNED_STAFF_FILTER,
  })
    .select("userId permissions")
    .lean();
  const userIds = profiles.map((profile) => profile.userId);

  const [totalStaff, activeStaff] = await Promise.all([
    User.countDocuments({
      _id: { $in: userIds },
      role: { $in: STAFF_USER_ROLES },
    }),
    User.countDocuments({
      _id: { $in: userIds },
      role: { $in: STAFF_USER_ROLES },
      $or: [
        { status: "active" },
        { status: { $exists: false } },
        { status: null },
      ],
    }),
  ]);

  return {
    totalStaff,
    activeStaff,
    inactiveStaff: totalStaff - activeStaff,
    posAccess: profiles.filter((profile) =>
      profile.permissions.includes("access_pos"),
    ).length,
  };
}
