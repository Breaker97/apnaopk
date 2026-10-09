/**
 * Sellers' applications to open a shop on the store: the list, one
 * application with its documents, and the decision.
 *
 * An application is the seller's shop while it waits for, or after, a
 * decision; its `id` is the shop's. The push sent to administrators when
 * someone applies links `/admin/vendors/{id}`: open `applications/{id}`.
 *
 * Administrators only (`REVIEW_VENDOR_APPLICATIONS`), in the platform
 * workspace, on a store with sellers (multi-vendor off: 404). Approving does
 * everything the website's approval does: the shop opens, or waits for its
 * first payment or starts its free trial, the applicant becomes a seller, and
 * they are told.
 *
 * Session B6.
 */
import * as z from "zod";

import { ImageSet, ListQuery, Money, listOf } from "./common";

/**
 * The list's tabs: `pending` (submitted, waiting for a decision; the
 * default), `approved`, `rejected`, `all`.
 */
export const VENDOR_APPLICATION_TABS = ["pending", "approved", "rejected", "all"] as const;

/**
 * GET /vendor-applications. `pending`: the one waiting longest first (by when
 * it was last submitted). The other tabs: the newest shop first. `approved`
 * holds shops awaiting their first payment too; `all` holds suspended ones.
 */
export const VendorApplicationListQuery = ListQuery.extend({
  tab: z.enum(VENDOR_APPLICATION_TABS).optional(),
  /** Part of the shop's name. */
  search: z.string().trim().min(1).max(100).optional(),
});
export type VendorApplicationListQuery = z.infer<typeof VendorApplicationListQuery>;

/** An application as the list shows it. */
export const VendorApplicationListItem = z.object({
  id: z.string(),
  storeName: z.string(),
  logo: ImageSet.optional(),
  applicantName: z.string(),
  applicantEmail: z.string(),
  /**
   * The store's own word: `submitted` (waiting for a decision), `approved`
   * (the shop is open, or awaits its first payment: see `paymentStatus`),
   * `rejected`, `suspended`; rarely `draft`, `payment_pending` or
   * `paid_pending_submit`, an applicant who never finished applying.
   */
  status: z.string(),
  /** When it was last submitted (an admin-created shop: when it was created). */
  submittedAt: z.string().optional(),
  /** The plan applied for, on a store that sells plans. */
  planName: z.string().optional(),
});
export type VendorApplicationListItem = z.infer<typeof VendorApplicationListItem>;

export const VendorApplicationList = listOf(VendorApplicationListItem);
export type VendorApplicationList = z.infer<typeof VendorApplicationList>;

/**
 * A document the applicant uploaded. `url` is a signed link that stops working
 * at `expiresAt` (a few minutes): open it before then, and read the
 * application again for a new one. A document the store cannot link to (kept
 * on an old server's own disk) is left out; the website still shows it.
 */
export const VendorApplicationDocument = z.object({
  /**
   * `business_license`, `tax_certificate`, `government_id`, or the key of a
   * document question the store added to its application form (with `label`).
   */
  kind: z.string(),
  /** The store's own question, for a document it asked for itself. */
  label: z.string().optional(),
  url: z.string(),
  expiresAt: z.string(),
});
export type VendorApplicationDocument = z.infer<typeof VendorApplicationDocument>;

/** One answer to the store's own application questions. */
export const VendorApplicationAnswer = z.object({
  label: z.string(),
  /** As written; a checkbox's is "Yes" or "No" (English), see `checked`. */
  value: z.string(),
  /** A checkbox's answer: show your own words for yes and no. */
  checked: z.boolean().optional(),
});
export type VendorApplicationAnswer = z.infer<typeof VendorApplicationAnswer>;

/** GET /vendor-applications/{id} */
export const VendorApplicationDetail = VendorApplicationListItem.extend({
  description: z.string(),
  banner: ImageSet.optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  website: z.string().optional(),
  taxId: z.string().optional(),
  documents: z.array(VendorApplicationDocument),
  answers: z.array(VendorApplicationAnswer),
  /**
   * The plan applied for (or, for a shop an administrator put on a plan, that
   * plan). `trialDays`: the free days approving it starts.
   */
  plan: z
    .object({
      name: z.string(),
      price: Money,
      /** `monthly`, `yearly`, `none` (free). */
      billingInterval: z.string(),
      trialDays: z.number().int(),
    })
    .optional(),
  /**
   * The plan's first payment: `not_required`, `unpaid` (a trial: due when it
   * ends), `pending` (due before the shop opens), `paid`, `failed`,
   * `expired`, `refunded`. Payments are settled on the website.
   */
  paymentStatus: z.string(),
  /** When it was approved or rejected. */
  decidedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  /** Whether POST …/decision would be accepted now. */
  canDecide: z.boolean(),
});
export type VendorApplicationDetail = z.infer<typeof VendorApplicationDetail>;

export const VENDOR_APPLICATION_DECISIONS = ["approve", "reject"] as const;

/**
 * POST /vendor-applications/{id}/decision. Send `Idempotency-Key`. A
 * rejection needs a `reason`, which the applicant is told (email and
 * notification) and reads before applying again. An approval ignores it.
 */
export const VendorApplicationDecisionRequest = z.object({
  decision: z.enum(VENDOR_APPLICATION_DECISIONS),
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type VendorApplicationDecisionRequest = z.infer<typeof VendorApplicationDecisionRequest>;

/** The answer to POST …/decision: the application after it. */
export const VendorApplicationDecisionResult = z.object({
  application: VendorApplicationDetail,
  /** The new shop's status: `approved`, or `payment_required` while it waits for its first payment. */
  vendorStatus: z.string().optional(),
});
export type VendorApplicationDecisionResult = z.infer<typeof VendorApplicationDecisionResult>;

/**
 * `reason` values of POST …/decision:
 * - 409 CONFLICT `ALREADY_DECIDED`: somebody decided first (read it again).
 * - 409 CONFLICT `NOT_SUBMITTED`: the applicant has not finished applying.
 * - 400 VALIDATION_ERROR `REASON_REQUIRED`: a rejection needs a reason.
 */
export const VENDOR_APPLICATION_REASONS = [
  "ALREADY_DECIDED",
  "NOT_SUBMITTED",
  "REASON_REQUIRED",
] as const;
export type VendorApplicationReason = (typeof VENDOR_APPLICATION_REASONS)[number];
