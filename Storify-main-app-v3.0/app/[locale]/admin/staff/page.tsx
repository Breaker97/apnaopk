import { Suspense } from "react";
import { BadgeCheck, Shield, Users, UserX } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { User, StaffProfile } from "@/models";
import { STAFF_USER_ROLES, TEAM_USER_ROLES } from "@/lib/access/staff-role";
import {
  PLATFORM_OWNED_STAFF_FILTER,
  getVendorOwnedStaffUserIds,
} from "@/lib/access/staff-ownership";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { StaffTableSection } from "@/components/admin/staff-table-section";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminStaffPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  const stats = await getStaffStats();

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
          <AdminListSkeleton stats={0} columns={6} tabs={4} thumbnail />
        }
      >
        <StaffTableSection locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

interface StaffStats {
  totalStaff: number;
  activeStaff: number;
  inactiveStaff: number;
  posAccess: number;
}

async function getStaffStats(): Promise<StaffStats> {
  await connectDB();

  // The team is administrators plus platform staff; exclude staff owned by a
  // vendor.
  const vendorOwnedUserIds = await getVendorOwnedStaffUserIds();

  const [totalStaff, activeUsers, profiles] = await Promise.all([
    User.countDocuments({
      role: { $in: TEAM_USER_ROLES },
      _id: { $nin: vendorOwnedUserIds },
    }),
    User.countDocuments({
      role: { $in: TEAM_USER_ROLES },
      _id: { $nin: vendorOwnedUserIds },
      $or: [
        { status: "active" },
        { status: { $exists: false } },
        { status: null },
      ],
    }),
    StaffProfile.find({ isActive: true, ...PLATFORM_OWNED_STAFF_FILTER })
      .select("userId permissions")
      .lean(),
  ]);

  // A staff member promoted to administrator keeps their profile dormant (so a
  // later demotion restores their permissions); it must not count as POS
  // access, which for admins is a POS setting, not a permission.
  const posCandidateIds = profiles
    .filter((p) => p.permissions.includes("access_pos"))
    .map((p) => p.userId);
  const posAccess =
    posCandidateIds.length === 0
      ? 0
      : await User.countDocuments({
          _id: { $in: posCandidateIds },
          role: { $in: STAFF_USER_ROLES },
        });

  return {
    totalStaff,
    activeStaff: activeUsers,
    inactiveStaff: totalStaff - activeUsers,
    posAccess,
  };
}
