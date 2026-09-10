/**
 * Models Index
 *
 * A convenience barrel, NOT a complete registry. Six models are reached only
 * through their own module — audit-log, expense, fiscal-period, ai-usage,
 * shipment-job, rate-limit-counter — because their consumers import them
 * directly, and exporting them here would add names nothing reads.
 *
 * So `await import("@/models")` registers most models with Mongoose, not all
 * of them. Anything that needs EVERY model (`scripts/reset.mjs`, which derives
 * the collections to clear from `mongoose.models`) has to walk `models/*.model.ts`
 * itself rather than trust this file.
 */

export { User } from "./user.model";
export { Vendor } from "./vendor.model";
export { VendorAccessRequest } from "./vendorAccessRequest.model";
export { VendorApplication } from "./vendorApplication.model";
export { VendorFollow } from "./vendorFollow.model";
export { VendorPlan } from "./vendorPlan.model";
export { VendorSubscription } from "./vendorSubscription.model";
export { VendorSubscriptionPayment } from "./vendorSubscriptionPayment.model";
export { BoostPosition } from "./boostPosition.model";
export { BoostSlotDay } from "./boostSlotDay.model";
export { BoostCampaign } from "./boostCampaign.model";
export { BoostMetricDaily } from "./boostMetricDaily.model";
export { PlatformPayment } from "./platformPayment.model";
export { LedgerEntry } from "./ledger-entry.model";
export { CommissionInvoice } from "./commissionInvoice.model";
export { WebhookEvent } from "./webhookEvent.model";
export {
  OnboardingTemplate,
  getOnboardingTemplate,
} from "./onboardingTemplate.model";
export { Category } from "./category.model";
export { Brand } from "./brand.model";
export { GlobalVariant } from "./global-variant.model";
export { Product } from "./product.model";
export { BarcodeRegistry } from "./barcode-registry.model";
export { Cart } from "./cart.model";
export { AbandonedCheckout } from "./abandoned-checkout.model";
export { Order } from "./order.model";
export { OrderComment } from "./order-comment.model";
export { Shipment } from "./shipment.model";
export { Review } from "./review.model";
export { QuoteRequest } from "./quote-request.model";
export { Wishlist } from "./wishlist.model";
export { Coupon } from "./coupon.model";
export { Notification } from "./notification.model";
export { EmailDelivery } from "./email-delivery.model";
export { PushSubscription } from "./push-subscription.model";
export { Settings, getSettings, getSettingsLean } from "./settings.model";
export type { ISettingsData } from "./settings.model";
export { CustomerProfile } from "./customer-profile.model";
export { AdminProfile } from "./admin-profile.model";
export { StaffProfile } from "./staff-profile.model";
export { InventoryLocation } from "./inventory-location.model";
export { LoginAttempt } from "./login-attempts.model";
export { PasswordReset } from "./password-reset.model";
export { Collection } from "./collection.model";
export { Transfer } from "./transfer.model";
export { PaymentTransaction } from "./payment-transaction.model";
export { ReturnRequest } from "./return-request.model";
export { Payout } from "./payout.model";
export { Counter, getNextSequence } from "./counter.model";
export { BlogPost } from "./blog-post.model";
export { BlogCategory } from "./blog-category.model";
export { BlogComment } from "./blog-comment.model";
export { Menu } from "./menu.model";
export { Slider } from "./slider.model";
export { StorePage } from "./store-page.model";
export { SavedSection } from "./saved-section.model";
export { AISalesConversation } from "./ai-sales-conversation.model";
export { Conversation } from "./conversation.model";
export { ConversationMessage } from "./conversation-message.model";
export { ConversationContact } from "./conversation-contact.model";
export { ConversationParticipant } from "./conversation-participant.model";
export { ChannelConnection } from "./channel-connection.model";
export { MessagingWebhookReceipt } from "./messaging-webhook-receipt.model";
export { MessageOutbox } from "./message-outbox.model";
export { WhatsAppTemplate } from "./whatsapp-template.model";
export { PlatformMessagingSettings } from "./platform-messaging-settings.model";
export { CronRun } from "./cron-run.model";
