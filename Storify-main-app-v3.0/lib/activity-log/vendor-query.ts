import { ActivityLogQuerySchema } from "@/lib/activity-log/query";

/**
 * The slice of the Activity Log's query string a vendor can send.
 *
 * `pick` rather than the admin's schema read and then ignored: a key that is not
 * named here is stripped before anything sees it, so `vendor`, `vendorId`,
 * `actorVendorId`, `role`, `outcome` and `resourceId` cannot reach the filter
 * whatever they hold — and a malformed one is dropped, not a 400. The vendor's
 * scope comes from the server-resolved store (`fetchActivityLogList`), never
 * from the request.
 */
export const VendorActivityLogQuerySchema = ActivityLogQuerySchema.pick({
  page: true,
  limit: true,
  date: true,
  actor: true,
  action: true,
  resource: true,
  tab: true,
});

/** What the vendor list takes, with the admin-only filters filled in as "none". */
export function toVendorListQuery(
  query: ReturnType<typeof VendorActivityLogQuerySchema.parse>,
) {
  return {
    ...query,
    role: undefined,
    vendor: undefined,
    resourceId: undefined,
    outcome: undefined,
    member: undefined,
    side: undefined,
  };
}
