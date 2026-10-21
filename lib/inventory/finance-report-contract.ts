import * as z from "zod";
const id = z.string().regex(/^[a-f\d]{24}$/i);
export const InventoryReportQuery = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), asOf: z.coerce.date().default(() => new Date()),
  productId: id.optional(), variantId: id.optional(), locationId: id.optional(),
  before: id.optional(), page: z.coerce.number().int().min(1).max(100000).optional(), search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
  from: z.coerce.date().optional(), actorId: z.string().max(200).optional(), state: z.enum(["owned_available", "owned_reserved_uncosted", "owned_unavailable", "owned_in_transit", "sale_costed", "returned_unvalued", "written_off"]).optional(), payment: z.enum(["paid", "unpaid", "already_recorded"]).optional(),
  reason: z.enum(["opening", "received", "count", "correction", "damaged", "theft_loss", "promotion_donation", "reserve", "release", "sale_costed", "return_restock", "transfer", "return_received", "cost_revaluation", "historical_reconciliation"]).optional(),
});
