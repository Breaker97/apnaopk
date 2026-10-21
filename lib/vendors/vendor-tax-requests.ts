import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Product, User, Vendor, VendorTaxRequest } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { NotificationType } from "@/models/notification.model";
import {
  VENDOR_TAX_REQUEST_STATUS,
  type IProductTaxValue,
  type IVendorTaxRequest,
} from "@/models/vendorTaxRequest.model";
import { createNotification } from "@/lib/notifications/notifications";
import { audit, type AuditContext } from "@/lib/audit";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { USER_ROLES } from "@/config/app.config";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import {
  BUILT_IN_TAX_CLASS_NAMES,
  isBuiltInTaxClass,
  taxClassOptions,
  vendorTaxChangePolicy,
  type StoredTaxSettings,
  type TaxClass,
} from "@/lib/tax/tax-settings";
import { productTaxOf, sameProductTax, type ProductTax } from "@/lib/tax/vendor-tax";

/**
 * A vendor's request to change their products' tax, and the admin's answer
 * (models/vendorTaxRequest.model.ts). Approving writes the asked-for tax onto
 * every product still in the vendor's catalog; declining leaves them as they
 * are. Both sides hear about it in-app, and both steps leave an audit row.
 */

export const MAX_TAX_REQUEST_PRODUCTS = 100;
const MIN_REASON = 10;
const MAX_REASON = 1000;

/** A tax as the request's sentences say it: "Exempt", "a custom rate of 7.5%". */
export function describeTax(tax: IProductTaxValue, classes: TaxClass[]): string {
  if (!tax.chargeTax) return "not charged";
  if (typeof tax.taxRate === "number") return `a custom rate of ${tax.taxRate}%`;
  if (!tax.taxClass) return "its category's tax";
  const known = classes.find((entry) => entry.key === tax.taxClass);
  const name = isBuiltInTaxClass(tax.taxClass)
    ? BUILT_IN_TAX_CLASS_NAMES[tax.taxClass]
    : known?.name || tax.taxClass;
  return `the ${name} class`;
}

const objectId = (value: unknown) => new Types.ObjectId(String(value));

/** How long an approval in progress holds its request before another answer may take it. */
const DECISION_LEASE_MS = 60_000;

/** The request is not being answered: no lease was taken, or the one taken has run out. */
const unleased = (now: Date) => ({
  $or: [{ decisionLease: null }, { "decisionLease.at": { $lt: new Date(now.getTime() - DECISION_LEASE_MS) } }],
});

const ALREADY_ANSWERED = "This request has already been answered or withdrawn, or is being answered right now.";

const productsPhrase = (count: number) => (count === 1 ? "1 product" : `${count} products`);

/**
 * The tax a request may ask for: a class and a custom rate replace each
 * other, a product that is not charged keeps neither, and a class must be one
 * the store has.
 */
function requestedTax(input: Partial<ProductTax>, classes: TaxClass[]): ProductTax {
  const chargeTax = input.chargeTax !== false;
  const taxClass = typeof input.taxClass === "string" && input.taxClass ? input.taxClass : null;
  const taxRate = typeof input.taxRate === "number" ? input.taxRate : null;
  if (!chargeTax) return { chargeTax, taxClass: null, taxRate: null };
  if (taxClass && taxRate !== null) {
    throw new ValidationError("Ask for a tax class or a custom tax rate, not both.");
  }
  if (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) {
    throw new ValidationError("A custom tax rate must be between 0% and 100%.");
  }
  if (taxClass && !classes.some((entry) => entry.key === taxClass)) {
    throw new ValidationError("Choose one of the store's tax classes.");
  }
  return { chargeTax, taxClass, taxRate };
}

async function taxContext() {
  const settings = await getSettingsLean();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const tax = settings.tax as StoredTaxSettings;
  return { policy: vendorTaxChangePolicy(tax), classes: taxClassOptions(tax) };
}

/** Let every admin know a request is waiting. Best-effort: never blocks the write. */
async function notifyAdmins(request: IVendorTaxRequest, storeName: string, asked: string) {
  try {
    const admins = await User.find({ role: USER_ROLES.ADMIN }).select("_id").lean<{ _id: unknown }[]>();
    const requestId = String(request._id);
    await Promise.all(
      admins.map((admin) =>
        createNotification({
          userId: String(admin._id),
          type: NotificationType.VENDOR_ACCESS_REQUEST,
          title: "Tax change request",
          message: `${storeName} asks to change the tax of ${productsPhrase(request.products.length)} to ${asked}.`,
          link: "/admin/settings/tax?tab=vendors",
          data: { event: "tax_change_request", requestId, recipientRole: USER_ROLES.ADMIN },
          dedupe: { type: NotificationType.VENDOR_ACCESS_REQUEST, "data.requestId": requestId },
        }),
      ),
    );
  } catch {
    // A notification failure must not lose the request the vendor just made.
  }
}

/** Tell the vendor what the store decided. Best-effort, same reasoning. */
async function notifyVendor(request: IVendorTaxRequest, approved: boolean, asked: string) {
  try {
    const vendor = await Vendor.findById(request.vendorId).select("userId").lean<{ userId?: unknown } | null>();
    if (!vendor?.userId) return;
    const what = productsPhrase(request.products.length);
    const note = request.decisionNote?.trim();
    await createNotification({
      userId: String(vendor.userId),
      type: NotificationType.VENDOR_ACCESS_REQUEST,
      title: approved ? "Tax change approved" : "Tax change declined",
      message: approved
        ? `The store set the tax of ${what} to ${asked}.`
        : `Your request to change the tax of ${what} was declined${note ? `: ${note}` : "."}`,
      link: request.products.length === 1
        ? `/vendor/products/${String(request.products[0].productId)}/edit`
        : "/vendor/products",
      data: { event: "tax_change_decision", requestId: String(request._id) },
    });
  } catch {
    // Same reasoning as above.
  }
}

/**
 * A vendor asks for one tax for some of their products. Refused when the
 * store does not take requests (it lets vendors change tax themselves, or
 * never), when a product is not theirs or already has an open request, or
 * when every product already has that tax.
 */
export async function createVendorTaxRequest(params: {
  vendor: { _id: unknown; storeName?: string };
  userId: string;
  productIds: string[];
  requested: Partial<ProductTax>;
  reason: string;
  auditContext: AuditContext;
}) {
  await connectDB();
  const { policy, classes } = await taxContext();
  if (policy === "free") {
    throw new ValidationError("You can change your products' tax yourself; no request is needed.");
  }
  if (policy === "never") {
    throw new AuthorizationError("Only the store can change a product's tax.");
  }

  const reason = params.reason.trim();
  if (reason.length < MIN_REASON) {
    throw new ValidationError("Add a sentence on why the tax should change.");
  }
  if (reason.length > MAX_REASON) {
    throw new ValidationError(`Keep the reason under ${MAX_REASON} characters.`);
  }

  const ids = [...new Set(params.productIds)];
  if (ids.length === 0) throw new ValidationError("Choose at least one product.");
  if (ids.length > MAX_TAX_REQUEST_PRODUCTS) {
    throw new ValidationError(`A request can name up to ${MAX_TAX_REQUEST_PRODUCTS} products.`);
  }
  if (ids.some((id) => !Types.ObjectId.isValid(id))) throw new ValidationError("A product id is not valid.");

  const requested = requestedTax(params.requested, classes);
  const vendorId = objectId(params.vendor._id);
  const products = await Product.find({ _id: { $in: ids }, vendorId })
    .select("name title chargeTax taxClass taxRate")
    .lean<Array<{ _id: unknown; name?: string; title?: string; chargeTax?: boolean; taxClass?: string | null; taxRate?: number | null }>>();
  if (products.length !== ids.length) {
    throw new ValidationError("One or more products do not belong to your store.");
  }
  const changing = products.filter((product) => !sameProductTax(productTaxOf(product), requested));
  if (changing.length === 0) {
    throw new ValidationError("These products already have that tax.");
  }

  const open = await VendorTaxRequest.findOne({
    status: VENDOR_TAX_REQUEST_STATUS.PENDING,
    productIds: { $in: changing.map((product) => objectId(product._id)) },
  })
    .select("products.name products.productId")
    .lean<{ products: Array<{ productId: unknown; name: string }> } | null>();
  if (open) {
    const pendingIds = new Set(changing.map((product) => String(product._id)));
    const name = open.products.find((product) => pendingIds.has(String(product.productId)))?.name;
    throw new ConflictError(
      `${name ? `"${name}"` : "A product"} already has a tax change request waiting. Withdraw it first, or wait for the store's answer.`,
    );
  }

  const request = await VendorTaxRequest.create({
    vendorId,
    products: changing.map((product) => ({
      productId: objectId(product._id),
      name: product.title || product.name || "Product",
      before: productTaxOf(product),
    })),
    productIds: changing.map((product) => objectId(product._id)),
    requested,
    reason,
    requestedBy: params.userId,
  });

  const asked = describeTax(requested, classes);
  const storeName = params.vendor.storeName || "A vendor";
  await audit(params.auditContext, {
    action: "CREATE",
    resource: "vendor",
    resourceId: String(params.vendor._id),
    resourceName: params.vendor.storeName,
    changes: { summary: `Requested ${asked} for ${productsPhrase(changing.length)}` },
    metadata: {
      taxRequestId: String(request._id),
      productIds: changing.map((product) => String(product._id)),
      requested,
      requestReason: reason,
    },
  });
  await notifyAdmins(request, storeName, asked);
  return request;
}

/** The vendor takes back a request the store has not answered. */
export async function withdrawVendorTaxRequest(params: {
  requestId: string;
  vendor: { _id: unknown; storeName?: string };
  userId: string;
  auditContext: AuditContext;
}) {
  await connectDB();
  if (!Types.ObjectId.isValid(params.requestId)) throw new NotFoundError("Tax change request");
  const filter = { _id: objectId(params.requestId), vendorId: objectId(params.vendor._id) };
  // One step: only a request still waiting is taken back, so a withdrawal and
  // the store's answer arriving together cannot both succeed.
  const now = new Date();
  const request = await VendorTaxRequest.findOneAndUpdate(
    { ...filter, status: VENDOR_TAX_REQUEST_STATUS.PENDING, ...unleased(now) },
    {
      $set: {
        status: VENDOR_TAX_REQUEST_STATUS.WITHDRAWN,
        decidedBy: params.userId,
        decidedAt: now,
      },
    },
    { new: true },
  );
  if (!request) {
    if (!(await VendorTaxRequest.exists(filter))) throw new NotFoundError("Tax change request");
    throw new ConflictError(ALREADY_ANSWERED);
  }
  await audit(params.auditContext, {
    action: "DELETE",
    resource: "vendor",
    resourceId: String(params.vendor._id),
    resourceName: params.vendor.storeName,
    changes: { summary: `Withdrew the tax change request for ${productsPhrase(request.products.length)}` },
    metadata: { taxRequestId: String(request._id) },
  });
  return request;
}

/**
 * The store's answer. Approving writes the asked-for tax onto the products
 * the vendor still owns, after checking a class asked for still exists.
 */
export async function decideVendorTaxRequest(params: {
  requestId: string;
  decision: "approved" | "declined";
  note?: string;
  actorId: string;
  auditContext: AuditContext;
}) {
  await connectDB();
  if (!Types.ObjectId.isValid(params.requestId)) throw new NotFoundError("Tax change request");
  const pending = await VendorTaxRequest.findById(params.requestId);
  if (!pending) throw new NotFoundError("Tax change request");
  if (pending.status !== VENDOR_TAX_REQUEST_STATUS.PENDING) {
    throw new ConflictError("This request has already been answered or withdrawn.");
  }
  const { classes } = await taxContext();
  const requested = productTaxOf(pending.requested);
  const asked = describeTax(requested, classes);
  const vendor = await Vendor.findById(pending.vendorId).select("storeName").lean<{ storeName?: string } | null>();
  const store = vendor?.storeName ? `${vendor.storeName}'s` : "the vendor's";
  const note = params.note?.trim() || null;
  const approved = params.decision === "approved";

  if (approved && requested.taxClass && !classes.some((entry) => entry.key === requested.taxClass)) {
    throw new ValidationError("The tax class asked for no longer exists. Decline the request instead.");
  }

  // An approval writes the products, so the request is first leased for it:
  // one step, only while it is pending and nobody else is answering, and the
  // request stays "pending" until the products have the tax. An approval and a
  // decline arriving together cannot both go through (the products used to
  // change under a declined request, and the vendor heard both answers), and
  // a write that fails or a process that dies leaves the request answerable
  // again — at the latest when the lease runs out — rather than approved with
  // nothing applied. The product write sets the same values wherever it
  // stopped, so a second try is safe.
  const token = new Types.ObjectId().toString();
  const now = new Date();
  if (approved) {
    const leased = await VendorTaxRequest.findOneAndUpdate(
      { _id: pending._id, status: VENDOR_TAX_REQUEST_STATUS.PENDING, ...unleased(now) },
      { $set: { decisionLease: { token, at: now } } },
      { new: true },
    );
    if (!leased) throw new ConflictError(ALREADY_ANSWERED);
    try {
      const products = await Product.find({ _id: { $in: leased.productIds }, vendorId: leased.vendorId })
        .select("_id slug")
        .lean<Array<{ _id: unknown; slug?: string }>>();
      if (products.length > 0) {
        await Product.updateMany(
          { _id: { $in: products.map((product) => product._id) }, vendorId: leased.vendorId },
          { $set: requested },
          { runValidators: true },
        );
        revalidateProductContent({ slugs: products.map((product) => product.slug) });
      }
    } catch (error) {
      // Best effort: if even this fails the lease simply runs out.
      await VendorTaxRequest.findOneAndUpdate(
        { _id: pending._id, "decisionLease.token": token },
        { $unset: { decisionLease: "" } },
      ).catch(() => undefined);
      throw error;
    }
  }

  const request = await VendorTaxRequest.findOneAndUpdate(
    approved
      ? { _id: pending._id, status: VENDOR_TAX_REQUEST_STATUS.PENDING, "decisionLease.token": token }
      : { _id: pending._id, status: VENDOR_TAX_REQUEST_STATUS.PENDING, ...unleased(now) },
    {
      $set: {
        status: approved ? VENDOR_TAX_REQUEST_STATUS.APPROVED : VENDOR_TAX_REQUEST_STATUS.DECLINED,
        decidedBy: params.actorId,
        decidedAt: new Date(),
        decisionNote: note,
      },
      $unset: { decisionLease: "" },
    },
    { new: true },
  );
  if (!request) throw new ConflictError(ALREADY_ANSWERED);

  const count = productsPhrase(request.products.length);
  await audit(params.auditContext, {
    action: params.decision === "approved" ? "APPROVAL" : "REJECTION",
    resource: "vendor",
    resourceId: String(request.vendorId),
    resourceName: vendor?.storeName,
    changes: {
      summary:
        params.decision === "approved"
          ? `Approved ${store} tax change: ${count} now ${asked}`
          : `Declined ${store} tax change for ${count}${note ? `: ${note}` : ""}`,
    },
    metadata: {
      taxRequestId: String(request._id),
      productIds: request.productIds.map(String),
      requested,
      requestReason: request.reason,
      ...(note ? { note } : {}),
    },
  });
  await notifyVendor(request, params.decision === "approved", asked);
  return request;
}
