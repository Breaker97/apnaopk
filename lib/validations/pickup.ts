import { z } from "zod";

import { assertValidPickupSchedule } from "@/lib/checkout/pickup-hours";

/**
 * Validation for a merchant's pickup branches.
 *
 * Lives here rather than beside one route because two of them write the same
 * shape: the vendor settings endpoint, and the admin one that manages the house
 * store's branches on a single-vendor install. Two copies of these rules would
 * drift, and the thing they guard is what checkout later trusts as the pickup
 * address.
 */

const PickupWeeklyHoursSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean().default(false),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const PickupLocationSchema = z
  .object({
    // The ID is deliberately vendor-owned and stable. It becomes the future
    // inventory-location reference, so it must not be inferred from a name or
    // address that a seller may later edit.
    id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    pickupArea: z.string().trim().max(160).optional(),
    pickupAddress: z.string().max(500).optional(),
    instructions: z.string().max(1000).optional(),
    timeZone: z.string().max(100).optional(),
    weeklyHours: z.array(PickupWeeklyHoursSchema).max(7).optional(),
  })
  .superRefine((location, ctx) => {
    try {
      assertValidPickupSchedule(location);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid pickup location",
      });
    }
  });

export const LocalPickupSchema = z
  .object({
    enabled: z.boolean().default(false),
    locations: z.array(PickupLocationSchema).max(20).optional(),
    pickupArea: z.string().trim().max(160).optional(),
    pickupAddress: z.string().max(500).optional(),
    instructions: z.string().max(1000).optional(),
    readyInDaysMin: z.number().min(0).optional(),
    readyInDaysMax: z.number().min(0).optional(),
    timeZone: z.string().max(100).optional(),
    weeklyHours: z.array(PickupWeeklyHoursSchema).max(7).optional(),
  })
  .superRefine((pickup, ctx) => {
    if (pickup.locations?.length) {
      const seen = new Set<string>();
      for (const location of pickup.locations) {
        if (seen.has(location.id)) {
          ctx.addIssue({
            code: "custom",
            message: "Pickup location IDs must be unique",
            path: ["locations"],
          });
          break;
        }
        seen.add(location.id);
      }

      if (pickup.enabled && !pickup.locations.some((location) => location.enabled)) {
        ctx.addIssue({
          code: "custom",
          message: "At least one pickup location must be enabled",
          path: ["locations"],
        });
      }
      return;
    }

    try {
      assertValidPickupSchedule(pickup);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid pickup schedule",
      });
    }
  });

