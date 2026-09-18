import { InventoryLocation, Transfer } from "@/models";
import { connectDB } from "@/lib/db";
import { transferVisibilityFilter } from "@/lib/inventory/transfers";
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
  /** Units accepted and rejected so far — how far a receipt has got. */
  receivedUnits: number;
  rejectedUnits: number;
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

function sumField(
  items: unknown,
  field: "quantity" | "receivedQuantity" | "rejectedQuantity",
): number {
  return Array.isArray(items)
    ? items.reduce(
        (sum: number, item: Record<string, unknown>) =>
          sum + (Number(item[field]) || 0),
        0,
      )
    : 0;
}

/**
 * The locations the list can be filtered by: every location for an admin, and
 * otherwise only the ones the caller holds.
 */
export async function fetchTransferLocationOptions(
  allowedLocationIds: ReadonlySet<string> | null,
): Promise<Array<{ id: string; name: string }>> {
  await connectDB();
  const rows = await InventoryLocation.find(
    allowedLocationIds === null ? {} : { _id: { $in: [...allowedLocationIds] } },
  )
    .select("name")
    .sort({ name: 1 })
    .lean<Array<{ _id: unknown; name?: string }>>();
  return rows.map((row) => ({ id: String(row._id), name: row.name || "" }));
}

export async function fetchTransferList(
  searchParams: URLSearchParams,
  /** From `resolveTransferLocationAccess`; `null` lists every transfer. */
  allowedLocationIds: ReadonlySet<string> | null,
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
  const locationId = (searchParams.get("location") || "").trim();
  const sortBy = (searchParams.get("sortBy") || "").trim();
  const sortOrder = searchParams.get("sortOrder") === "asc" ? 1 : -1;

  // Only transfers touching a location the caller holds — the tab counters
  // below start from this too, or they would count other stores' transfers.
  const scopeQuery = transferVisibilityFilter(allowedLocationIds);
  const baseQuery: Record<string, unknown>[] = [scopeQuery];
  if (locationId && locationId !== "all") {
    baseQuery.push({
      $or: [{ fromLocationId: locationId }, { toLocationId: locationId }],
    });
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    baseQuery.push({
      $or: [
        { transferNumber: { $regex: escaped, $options: "i" } },
        { fromLocationName: { $regex: escaped, $options: "i" } },
        { toLocationName: { $regex: escaped, $options: "i" } },
        { reference: { $regex: escaped, $options: "i" } },
      ],
    });
  }

  const unfiltered: Record<string, unknown> = { $and: baseQuery };
  const query: Record<string, unknown> =
    status !== "all" ? { $and: [...baseQuery, { status }] } : unfiltered;

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
      { $match: unfiltered },
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
    itemCount: sumField(record.items, "quantity"),
    receivedUnits: sumField(record.items, "receivedQuantity"),
    rejectedUnits: sumField(record.items, "rejectedQuantity"),
    totalLines: Array.isArray(record.items) ? record.items.length : 0,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  }));

  return {
    ...listResult(items, page, limit, total),
    counters: {
      // Every status, not `total` — that one is narrowed to the active tab.
      all: Object.values(totalsByStatus).reduce(
        (sum: number, count) => sum + Number(count || 0),
        0,
      ),
      draft: totalsByStatus.draft || 0,
      ready_to_ship: totalsByStatus.ready_to_ship || 0,
      in_transit: totalsByStatus.in_transit || 0,
      completed: totalsByStatus.completed || 0,
      cancelled: totalsByStatus.cancelled || 0,
    },
  };
}
