"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ExternalLink, Package } from "lucide-react";
import {
  DataTable,
  CurrencyCell,
  StatusCell,
  type DataTableColumn,
} from "@/components/ui/data-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface VendorProductRow {
  _id: string;
  name: string;
  sku?: string;
  price: number;
  currency?: string;
  stock?: number;
  status: string;
  thumbnailUrl?: string;
  images?: { url: string; type?: string }[];
}

interface ProductsResponse {
  data: VendorProductRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

interface ProductsTabProps {
  vendorId: string;
  basePath: string;
  /** Reports the authoritative product count up so the header KPI can match. */
  onTotalChange?: (total: number) => void;
}

// Keys are the PRODUCT_STATUS enum values. `archived`/`outofstock` are not
// product statuses in this schema — they never matched a row.
const PRODUCT_STATUS_MAP = {
  active: { label: "Active", variant: "default" as const },
  draft: { label: "Draft", variant: "outline" as const },
  unlisted: { label: "Unlisted", variant: "secondary" as const },
};

function productThumb(row: VendorProductRow) {
  if (row.thumbnailUrl) return row.thumbnailUrl;
  const image = row.images?.find((item) => item.type !== "video");
  return image?.url;
}

export function ProductsTab({
  vendorId,
  basePath,
  onTotalChange,
}: ProductsTabProps) {
  const router = useRouter();
  const [rows, setRows] = useState<VendorProductRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);

  useApplyOnChange([vendorId, page, onTotalChange], () => {
    setIsLoading(true);
  });

  useEffect(() => {
    let active = true;

    // The admin products endpoint returns { data, pagination, filters } — not
    // the standard paginatedResponse envelope — so we read those shapes here.
    apiClient
      .get<ProductsResponse>(
        `/api/admin/products?vendor=${vendorId}&page=${page}&limit=10`,
      )
      .then((res) => {
        if (!active) return;
        setRows(res.data || []);
        setPagination({
          page: res.pagination.page,
          pageSize: res.pagination.limit,
          total: res.pagination.total,
          totalPages: res.pagination.totalPages,
        });
        onTotalChange?.(res.pagination.total);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load vendor products:", error);
        toast.error("Failed to load products");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vendorId, page, onTotalChange]);

  const columns: DataTableColumn<VendorProductRow>[] = [
    {
      id: "product",
      header: "Product",
      cell: (row) => {
        const thumb = productThumb(row);
        return (
          <Link
            href={`${basePath}/products/${row._id}`}
            className="group inline-flex min-w-0 items-center gap-3"
          >
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
              {thumb ? (
                <Image
                  src={thumb}
                  alt={row.name}
                  fill
                  sizes="40px"
                  className="object-cover"
                />
              ) : (
                <Package className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 truncate font-medium group-hover:underline">
                {row.name}
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              </span>
              {row.sku && (
                <span className="block truncate text-xs text-muted-foreground">
                  {row.sku}
                </span>
              )}
            </span>
          </Link>
        );
      },
    },
    {
      id: "price",
      header: "Price",
      cell: (row) => <CurrencyCell value={row.price} />,
      className: "w-[130px]",
    },
    {
      id: "stock",
      header: "Stock",
      cell: (row) => (
        <span className="tabular-nums">{(row.stock ?? 0).toLocaleString()}</span>
      ),
      className: "w-[100px]",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusCell status={row.status} statusMap={PRODUCT_STATUS_MAP} />
      ),
      className: "w-[130px]",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Products</CardTitle>
        <CardDescription>
          Products owned by this vendor, newest first
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={columns}
          keyField="_id"
          isLoading={isLoading}
          loadingMode="rows"
          pagination={pagination ?? undefined}
          onPageChange={setPage}
          onRowClick={(row) => {
            router.push(`${basePath}/products/${row._id}`);
          }}
          emptyMessage="This vendor has no products yet"
        />
      </CardContent>
    </Card>
  );
}
