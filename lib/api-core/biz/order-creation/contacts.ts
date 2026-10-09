import { Types } from "mongoose";
import { OrderContactCreateRequest, OrderContactCreateResult, MANUAL_ORDER_REASONS } from "@/contracts/mobile/biz/v1/order-creation";
import { BIZ_ACCESS, assertCapability } from "@/lib/api-core/biz/access";
import { customerDirectoryIsGlobal } from "@/lib/api-core/biz/scope";
import { defineBizRoute } from "@/lib/api-core/registry";
import { bizOperationBinding, runDurableBizOperation, DefiniteOperationFailure, type OperationResourceRef } from "@/lib/api-core/biz/durable-operation";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { financeSession } from "@/lib/finance/transaction";
import { manualCreationTransaction } from "@/lib/orders/manual-creation-transaction";
import { User } from "@/models/user.model";
import { CustomerProfile } from "@/models/customer-profile.model";
import { isCountryAllowed, countryCodeForValue } from "@/lib/intl/country-availability";
import { Settings } from "@/models/settings.model";
import { MobileApiError } from "@/lib/api-core/errors";
import { contactSelector } from "./customers";
import { creationRefusal, type CreationContext } from "./policy";

export async function authorizeOrderContactResources(context: CreationContext, resources: readonly OperationResourceRef[]) {
  assertCapability(context.workspace, "CREATE_ORDER_CONTACTS");
  if (!customerDirectoryIsGlobal(context.scope)) creationRefusal("CONTACT_CREATE_NOT_ALLOWED", "This customer grant is limited to existing scoped orders.", 403);
  for (const resource of resources) {
    if (resource.kind !== "customer" || !resource.id.startsWith("guest:") || !Types.ObjectId.isValid(resource.id.slice(6)) ||
      !await CustomerProfile.exists({ _id: resource.id.slice(6), isGuest: true })) throw new MobileApiError(404, "NOT_FOUND", "Contact not found.");
  }
}
export const orderContactCreateRoute = defineBizRoute({
  id: "orders.creation.contacts.create", method: "POST", path: "/orders/creation/contacts", auth: "user",
  ...BIZ_ACCESS.CREATE_ORDER_CONTACTS, cache: { kind: "private" }, status: 201,
  rateLimit: { bucket: "biz:order-contacts:create", preset: "moderate" }, demo: "default",
  idempotency: "required", durable: true, input: OrderContactCreateRequest, output: OrderContactCreateResult,
  reasons: { values: MANUAL_ORDER_REASONS },
  handler: async ({ input, workspace, scope, session, locale, client }) => {
    const context: CreationContext = { actorId: session.user.id, workspace, scope, locale };
    const email = input.email.toLowerCase();
    const binding = bizOperationBinding({ actorId: context.actorId, workspace, key: client.idempotencyKey,
      routeId: "orders.creation.contacts.create", target: email, payload: input });
    const result = await runDurableBizOperation<string>({ binding, store: mongoBizOperationStore,
      authorize: (resources) => authorizeOrderContactResources(context, resources),
      execute: async (operation) => {
        const id = typeof operation.checkpoint?.contactId === "string" ? operation.checkpoint.contactId : String(new Types.ObjectId());
        await operation.remember({ contactId: id });
        const customer = await manualCreationTransaction(operation, "business order contact", async () => {
          const dbSession = financeSession()!;
          if (await User.exists({ email }).session(dbSession)) throw new DefiniteOperationFailure({ status: 409, code: "CONFLICT", reason: "CONTACT_CREATE_NOT_ALLOWED", message: "An account already uses this email. Select its authorized customer record." });
          const settings = await Settings.findOne().session(dbSession).lean();
          if (input.shippingAddress && (!countryCodeForValue(input.shippingAddress.country) || !isCountryAllowed(input.shippingAddress.country, settings?.general?.countryAvailability))) {
            throw new DefiniteOperationFailure({ status: 409, code: "CONFLICT", reason: "DELIVERY_NOT_ALLOWED", message: "The address country is unavailable." });
          }
          const existing = await CustomerProfile.findOne({ isGuest: true, email }).session(dbSession).lean();
          // Selecting an existing contact never changes its profile or consent.
          if (existing) return existing;
          const phone = input.phone?.trim() || undefined;
          if (phone && await CustomerProfile.exists({ isGuest: true, phone, email: { $ne: email } }).session(dbSession)) {
            throw new DefiniteOperationFailure({ status: 409, code: "CONFLICT", reason: "CONTACT_CREATE_NOT_ALLOWED", message: "This phone belongs to another contact. Select its authorized record." });
          }
          const [created] = await CustomerProfile.create([{ _id: id, isGuest: true, email, name: input.name, phone,
            ...(input.shippingAddress ? { shippingAddress: { ...input.shippingAddress, firstName: input.name } } : {}) }], { session: dbSession });
          return created.toObject();
        }).catch((error: unknown) => {
          // A uniqueness rejection aborted this transaction before a contact was written.
          if ((error as { code?: number } | null)?.code === 11000) {
            throw new DefiniteOperationFailure({ status: 409, code: "CONFLICT", reason: "CONTACT_CREATE_NOT_ALLOWED", message: "Contact details changed concurrently. Refresh the selector." });
          }
          throw error;
        });
        return { data: String(customer._id), resources: [{ kind: "customer" as const, id: `guest:${customer._id}` }] };
      },
      reconcile: async (operation) => {
        if (typeof operation.checkpoint?.contactId !== "string") return { state: "not_applied" as const };
        const customer = await CustomerProfile.findOne({ _id: operation.checkpoint.contactId, email, isGuest: true }).select("_id").lean();
        if (!customer && operation.checkpoint.primaryStarted && !operation.checkpoint.primaryAborted) return { state: "unknown" as const };
        return customer ? { state: "succeeded" as const, data: String(customer._id), resources: [{ kind: "customer" as const, id: `guest:${customer._id}` }] } : { state: "not_applied" as const };
      },
    });
    const customer = await CustomerProfile.findOne({ _id: result.data, isGuest: true }).select("_id name email phone shippingAddress").lean();
    if (!customer) throw new MobileApiError(404, "NOT_FOUND", "Contact not found.");
    return { operation: result.operation, customer: contactSelector(customer) };
  },
});
