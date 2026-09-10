import { Transfer } from "@/models";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Stock transfer list query.
 *
 * Shared by `GET /api/admin/transfers` and the transfers page's server
 * component so the endpoint and the rendered page always read a query string
 * the same way.
 */

interface TransferListRow {
  _id: string;
  transferNumber: string;
  status: string;
  fromLocationName?: string;
  toLocationName?: string;
  itemCount: number;
  totalLines: number;
  updatedAt?: Date | string;
  createdAt?: Date | string;
}

export interface TransferStatusCounters {
  all: number;
  draft: number;
  ready_to_ship: number;
  in_transit: number;
  completed: number;
  cancelled: number;
}

interface TransferListResult extends ListResult<TransferListRow> {
  /** Per-status totals behind the tab strip. */
  counters: TransferStatusCounters;
}

const SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "transferNumber",
  "status",
]);

export const TRANSFERS_DEFAULT_PAGE_SIZE = 20;

function itemQuantity(items: unknown): number {
  return Array.isArray(items)
    ? items.reduce(
        (sum: number, item: { quantity?: number }) =>
          sum + (Number(item.quantity) || 0),
        0,
      )
    : 0;
}

export async function fetchTransferList(
  searchParams: URLSearchParams,
): Promise<TransferListResult> {
  await connectDB();

  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const limit = Math.min(
    100,
    Math.max(
      1,
      Number(searchParams.get("limit") || TRANSFERS_DEFAULT_PAGE_SIZE),
    ),
  );
  const status = (searchParams.get("status") || "all").trim();
  const search = (searchParams.get("search") || "").trim();
  const sortBy = (searchParams.get("sortBy") || "").trim();
  const sortOrder = searchParams.get("sortOrder") === "asc" ? 1 : -1;

  const query: Record<string, unknown> = {};
  if (status !== "all") query.status = status;

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { transferNumber: { $regex: escaped, $options: "i" } },
      { fromLocationName: { $regex: escaped, $options: "i" } },
      { toLocationName: { $regex: escaped, $options: "i" } },
      { reference: { $regex: escaped, $options: "i" } },
    ];
  }

  // `createdAt` already orders rows unambiguously; the others tie constantly,
  // so they get it appended or a row could straddle two pages.
  let sort: Record<string, 1 | -1> = { createdAt: -1 };
  if (sortBy && SORT_FIELDS.has(sortBy)) {
    sort =
      sortBy === "createdAt"
        ? { createdAt: sortOrder }
        : { [sortBy]: sortOrder, createdAt: -1 };
  }

  const [records, total, statusAgg] = await Promise.all([
    Transfer.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    countForQuery(Transfer, query),
    Transfer.aggregate([
      // The tab counters ignore the status filter (they populate the tabs
      // themselves) but must respect an active search.
      { $match: search ? query : {} },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const totalsByStatus = statusAgg.reduce(
    (acc: Record<string, number>, row: { _id: string; count: number }) => {
      if (row?._id) acc[row._id] = row.count || 0;
      return acc;
    },
    {},
  );

  const items: TransferListRow[] = records.map((record) => ({
    _id: String(record._id),
    transferNumber: record.transferNumber,
    status: record.status,
    fromLocationName: record.fromLocationName,
    toLocationName: record.toLocationName,
    itemCount: itemQuantity(record.items),
    totalLines: Array.isArray(record.items) ? record.items.length : 0,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  }));

  return {
    ...listResult(items, page, limit, total),
    counters: {
      all: total,
      draft: totalsByStatus.draft || 0,
      ready_to_ship: totalsByStatus.ready_to_ship || 0,
      in_transit: totalsByStatus.in_transit || 0,
      completed: totalsByStatus.completed || 0,
      cancelled: totalsByStatus.cancelled || 0,
    },
  };
}
