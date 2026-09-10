import { Suspense } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminUsersTable } from "@/components/admin/users-table";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminUsersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  const t = await getTranslations({ locale });

  const page = typeof search.page === "string" ? parseInt(search.page) : 1;
  const limit = typeof search.limit === "string" ? parseInt(search.limit) : 10;
  const role = typeof search.role === "string" ? search.role : undefined;
  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold">{t("admin.users")}</h1>
        <p className="text-muted-foreground">
          {t("admin.usersDesc")}
        </p>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>View and manage registered users</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<UsersTableSkeleton />}>
            <AdminUsersTable
              locale={locale}
              page={page}
              limit={Number.isFinite(limit) && limit > 0 ? limit : 10}
              role={role}
              search={searchQuery}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

function UsersTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}
