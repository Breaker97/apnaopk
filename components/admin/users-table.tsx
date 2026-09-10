"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  MoreHorizontal,
  Search,
  Filter,
  Trash2,
  Shield,
  User as UserIcon,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DataTablePagination,
  type DataTablePaginationType,
} from "@/components/ui/data-table";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface User {
  _id: string;
  name: string;
  email: string;
  image?: string;
  role: string;
  status?: "active" | "inactive" | "banned";
  createdAt: string;
  emailVerified: boolean;
}

interface AdminUsersTableProps {
  locale: string;
  page: number;
  limit?: number;
  role?: string;
  search?: string;
}

export function AdminUsersTable({
  page,
  limit = 10,
  role,
  search,
}: AdminUsersTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useConfirmation();

  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<DataTablePaginationType>({
    page: 1,
    pageSize: limit,
    totalPages: 1,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchValue, setSearchValue] = useState(search || "");

  const fetchUsers = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", String(limit));
    if (search) params.set("search", search);
    if (role && role !== "all") params.set("role", role);

    return fetch(`/api/admin/users?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;
        setUsers(data.data?.data || data.data || []);
        setPagination((prev) => ({
          page: data.data?.pagination?.page ?? 1,
          pageSize: data.data?.pagination?.limit ?? prev.pageSize,
          total: data.data?.pagination?.total ?? 0,
          totalPages: data.data?.pagination?.totalPages ?? 1,
        }));
      })
      .catch((error) => {
        console.error("Failed to fetch users:", error);
      })
      .finally(() => setIsLoading(false));
  }, [page, limit, search, role]);
  // Reloads after an action show the spinner; the effect below sets it during
  // render when the query changes.
  const refreshUsers = useCallback(() => {
    setIsLoading(true);
    return fetchUsers();
  }, [fetchUsers]);

  useApplyOnChange([page, limit, search, role], () => {
    setIsLoading(true);
  });
  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (searchValue) {
      params.set("search", searchValue);
    } else {
      params.delete("search");
    }
    params.delete("page");
    router.push(`?${params.toString()}`);
  };

  const handleRoleFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set("role", value);
    } else {
      params.delete("role");
    }
    params.delete("page");
    router.push(`?${params.toString()}`);
  };

  const handlePageChange = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    router.push(`?${params.toString()}`);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", String(nextPageSize));
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        toast.success("User role updated successfully");
        refreshUsers();
      } else {
        const data = await res.json();
        toast.error(data.message || "Failed to update role");
      }
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleUpdateStatus = async (userId: string, status: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (res.ok) {
        toast.success("User status updated successfully");
        refreshUsers();
      } else {
        const data = await res.json();
        toast.error(data.message || "Failed to update status");
      }
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleDelete = async (userId: string, userName: string) => {
    const confirmed = await confirm({
      title: "Delete User",
      description: `Are you sure you want to delete "${userName}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    });

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("User deleted successfully");
        refreshUsers();
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.message || "Failed to delete user");
      }
    } catch {
      toast.error(t("common.error"));
    }
  };

  const getRoleBadge = (role: string) => {
    const config: Record<
      string,
      {
        variant: "default" | "secondary" | "outline" | "destructive";
        icon: LucideIcon;
      }
    > = {
      [USER_ROLES.ADMIN]: { variant: "destructive", icon: Shield },
      [USER_ROLES.VENDOR]: { variant: "default", icon: Store },
      [USER_ROLES.CUSTOMER]: { variant: "secondary", icon: UserIcon },
    };
    const { variant, icon: Icon } = config[role] || config[USER_ROLES.CUSTOMER];
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {role.charAt(0).toUpperCase() + role.slice(1)}
      </Badge>
    );
  };

  const getStatusBadge = (status?: string) => {
    if (status === USER_ACCOUNT_STATUS.BANNED) {
      return <Badge variant="destructive">Banned</Badge>;
    }
    if (status === USER_ACCOUNT_STATUS.INACTIVE) {
      return <Badge variant="outline">Inactive</Badge>;
    }
    return <Badge variant="default">Active</Badge>;
  };

  if (isLoading) {
    return <UsersTableSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-10"
          />
        </div>
        <Select value={role || "all"} onValueChange={handleRoleFilter}>
          <SelectTrigger className="w-40">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value={USER_ROLES.CUSTOMER}>Customer</SelectItem>
            <SelectItem value={USER_ROLES.VENDOR}>Vendor</SelectItem>
            <SelectItem value={USER_ROLES.ADMIN}>Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handleSearch}>
          Search
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-[70px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user._id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user.image} />
                        <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{getRoleBadge(user.role)}</TableCell>
                  <TableCell>{getStatusBadge(user.status)}</TableCell>
                  <TableCell>
                    {format(new Date(user.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            navigator.clipboard.writeText(user.email)
                          }
                        >
                          Copy Email
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Shield className="mr-2 h-4 w-4" />
                            Change Role
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup
                              value={user.role}
                              onValueChange={(val) =>
                                handleUpdateRole(user._id, val)
                              }
                            >
                              <DropdownMenuRadioItem
                                value={USER_ROLES.CUSTOMER}
                              >
                                Customer
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value={USER_ROLES.VENDOR}>
                                Vendor
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value={USER_ROLES.ADMIN}>
                                Admin
                              </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <UserIcon className="mr-2 h-4 w-4" />
                            Account Status
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup
                              value={user.status || USER_ACCOUNT_STATUS.ACTIVE}
                              onValueChange={(val) =>
                                handleUpdateStatus(user._id, val)
                              }
                            >
                              <DropdownMenuRadioItem value={USER_ACCOUNT_STATUS.ACTIVE}>
                                Active
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value={USER_ACCOUNT_STATUS.INACTIVE}>
                                Inactive
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value={USER_ACCOUNT_STATUS.BANNED}>
                                Banned
                              </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(user._id, user.name)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />
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
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-[70px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-8 w-8" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
