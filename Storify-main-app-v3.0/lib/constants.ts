/**
 * Application-wide constants
 */

// Payment methods
export const PAYMENT_METHODS = [
  { id: "card", label: "Credit/Debit Card", icon: "CreditCard" },
  { id: "paypal", label: "PayPal", icon: "Wallet" },
  { id: "razorpay", label: "Razorpay", icon: "Wallet" },
  { id: "paystack", label: "Paystack", icon: "Wallet" },
  { id: "pesapal", label: "Pesapal", icon: "Wallet" },
  { id: "iotec", label: "ioTec Pay", icon: "Smartphone" },
  { id: "orange_money", label: "Orange Money", icon: "Smartphone" },
  { id: "mtn_momo", label: "MTN Mobile Money", icon: "Smartphone" },
  { id: "cod", label: "Cash on Delivery", icon: "Banknote" },
] as const;

// Floating label CSS classes for Shopify-style inputs
export const FLOATING_INPUT_CLASS =
  "peer h-14 rounded-lg pt-6 pb-1.5 text-base placeholder-transparent";
export const FLOATING_LABEL_CLASS =
  "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground transition-all duration-150 peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs";
