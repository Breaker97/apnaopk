import { escapeRegExp } from "@/lib/strings";

/**
 * The email and SMS delivery logs (Settings → Email, Settings → SMS) show an
 * outbox in four tabs: every row, what went out, what did not, and what is
 * still on its way. Both log routes filter and count by these groups.
 */
export const DELIVERY_LOG_GROUPS = ["sent", "failed", "waiting"] as const;
export type DeliveryLogGroup = (typeof DELIVERY_LOG_GROUPS)[number];

/** Each status's tab; null for one shown under All only. */
const GROUP_OF_STATUS: Readonly<Record<string, DeliveryLogGroup | null>> = {
  sent: "sent",
  // A text the carrier confirmed.
  delivered: "sent",
  failed: "failed",
  // A text Twilio accepted and the carrier then could not deliver.
  undelivered: "failed",
  queued: "waiting",
  sending: "waiting",
  retrying: "waiting",
  // An email an admin called off. Not "failed": the Failed tab is what can be
  // retried, and its "Retry all" count must not promise these.
  cancelled: null,
};

export function isDeliveryLogGroup(value: unknown): value is DeliveryLogGroup {
  return (
    typeof value === "string" &&
    (DELIVERY_LOG_GROUPS as readonly string[]).includes(value)
  );
}

/** The statuses of an outbox that make up one group. */
export function statusesInGroup<Status extends string>(
  group: DeliveryLogGroup,
  statuses: readonly Status[],
): Status[] {
  return statuses.filter((status) => GROUP_OF_STATUS[status] === group);
}

/** The date ranges the log offers; "all" is the whole log. */
export const DELIVERY_LOG_RANGES = ["all", "today", "7d", "30d", "90d"] as const;
const RANGE_DAYS: Readonly<Record<string, number>> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * The rows a log shows before a tab narrows them: inside the date range, and
 * matching the search in one of `searchFields`. The tab counts are taken over
 * exactly these rows, so the numbers agree with the table under them. They
 * used to count the whole outbox while the table showed the last 30 days.
 */
export function deliveryLogFilter(params: {
  range?: string | null;
  search?: string | null;
  searchFields: readonly string[];
  now?: Date;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const search = params.search?.trim().slice(0, 200);
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), "i");
    filter.$or = params.searchFields.map((field) => ({ [field]: pattern }));
  }
  const days = params.range ? RANGE_DAYS[params.range] : undefined;
  if (days) {
    const now = params.now ?? new Date();
    filter.createdAt = {
      $gte: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    };
  }
  return filter;
}

export type DeliveryLogCounts = {
  total: number;
  sent: number;
  failed: number;
  waiting: number;
};

/** Rows counted by status (an aggregate's `$group`), as the log's tab counts. */
export function countDeliveryLogGroups(
  rows: ReadonlyArray<{ _id: unknown; count: number }>,
): DeliveryLogCounts {
  const counts: DeliveryLogCounts = { total: 0, sent: 0, failed: 0, waiting: 0 };
  for (const row of rows) {
    const status = String(row._id);
    if (!Object.hasOwn(GROUP_OF_STATUS, status)) continue;
    counts.total += row.count;
    const group = GROUP_OF_STATUS[status];
    if (group) counts[group] += row.count;
  }
  return counts;
}
