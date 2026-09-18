"use client";

import { z } from "zod";
import Link from "next/link";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { useTranslations } from "next-intl";
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  loadStripe,
  type Stripe,
  type StripeCardCvcElement,
  type StripeCardExpiryElement,
  type StripeCardNumberElement,
  type StripeElements,
} from "@stripe/stripe-js";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CreditCard,
  Loader2,
  AlertCircle,
  Lock,
  Truck,
  Wallet,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { useCart } from "@/hooks/use-cart";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/providers/currency-provider";
import {
  buildPreorderMandateText,
  preorderMandateRequired,
} from "@/lib/payments/preorder-mandate";
import { toast } from "@/components/ui/toast-notification";
import { AppImage } from "@/components/ui/app-image";
import { CouponInput } from "@/components/checkout/coupon-input";
import {
  PickupFulfillmentSelector,
  type CheckoutPickupLocation,
} from "@/components/checkout/pickup-fulfillment-selector";
import { SavedAddressSelector } from "@/components/checkout/saved-address-selector";
import { CheckoutSkeleton } from "@/components/checkout/checkout-skeleton";
import { CountrySelect } from "@/components/common/country-multi-select";
import {
  RegionSelect,
  regionsForCountry,
} from "@/components/common/region-select";
import { useAppTheme } from "@/providers/theme-provider";
import { useAppSettings } from "@/providers/app-settings-provider";
import {
  getAllowedCountryOptions,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import {
  calculateShipping,
  estimateCustomsDuty,
  CANONICAL_CART_WEIGHT_UNIT,
  SHIPPING_UNAVAILABLE_MESSAGE,
  type ShippingSettings,
} from "@/lib/shipping/shipping";
import {
  calculateCheckoutTotals,
  isFreeShippingCouponType,
} from "@/lib/catalog/discounts";
import {
  analyticsItemsFromCart,
  saveCheckoutAnalyticsSnapshot,
  trackCheckout,
  trackPaymentInfo,
} from "@/lib/analytics/events";
import { saveGuestCheckoutEmail } from "@/lib/checkout/checkout-guest-contact";
import { isCartPricesChangedResponse } from "@/lib/checkout/cart-price-change";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_ORDER_SHIPPING_COST,
  DEFAULT_ORDER_TAX_RATE,
} from "@/lib/orders/order-settings";
import { signOut, signUp } from "@/lib/auth/auth-client";
import {
  contactModeCollects,
  type CheckoutCustomField,
  type ConfigurableAddressField,
  type PublicCheckoutSettings,
} from "@/lib/checkout/checkout-config";
import {
  CHECKOUT_NOTE_MAX,
  activeCheckoutCustomFields,
  evaluateCheckoutSubmission,
  paymentMethodNeedsEmail,
  type CheckoutIssueCode,
} from "@/lib/checkout/checkout-form-policy";
import { MIN_ALLOWED_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import {
  requiresPickupSelection,
  type CheckoutFulfillmentMethod,
} from "@/lib/checkout/pickup-fulfillment-shared";
import {
  DELIVERY_DESTINATION_FIELDS,
  MANUAL_DELIVERY_ADDRESS_FIELDS,
  PaymentProviderLogo,
  accountRecipientName,
  buildCheckoutAddressPayload,
  canOfferToSaveAddress,
  createStripeElementStyle,
  defaultSavedAddressIndex,
  filterUsableSavedCheckoutAddresses,
  floatingInputClass,
  floatingLabelClass,
  formatPreorderDate,
  getCheckoutProductId,
  getCouponErrorMessage,
  hasDeliveryDestination,
  openRazorpayCheckout,
  requiresFreshShippingQuote,
  savedAddressFormValues,
  savedAddressIndexForLocation,
  shouldShowFulfillmentSelector,
  shouldShowManualDeliveryAddressForm,
  type AppliedCoupon,
  type CheckoutCartItem,
  type CheckoutFormData,
  type CheckoutShippingResolution,
  type CheckoutVendorRateGroup,
  type SavedCheckoutAddress,
} from "@/components/checkout/checkout-helpers";
import { resolveInitialPickupLocationId } from "@/lib/checkout/pickup-distance";
import {
  shopperLocationCity,
  shopperLocationOrigin,
} from "@/lib/locations/shopper-location";
import { readStoredShopperLocationFromBrowser } from "@/lib/locations/shopper-location-client";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { preorderOutstandingAfterCoupon } from "@/lib/orders/preorder-coupon-split";

type PickupAvailabilityState = {
  loading: boolean;
  eligible: boolean;
  reason?: "cart_empty" | "multi_vendor" | "not_configured";
  vendor?: {
    id: string;
    name: string;
  };
  locations: CheckoutPickupLocation[];
};

type CheckoutDeliveryAddressMode = "saved" | "manual";

// ioTec Pay collects either through a mobile-money PIN prompt or its hosted
// card page; the channel picks which collection endpoint checkout calls.
const IOTEC_CHANNELS = [
  {
    value: "mobile_money" as const,
    labelKey: "checkout.payment.iotecMobileMoney",
    icon: Smartphone,
  },
  {
    value: "card" as const,
    labelKey: "checkout.payment.iotecCard",
    icon: CreditCard,
  },
];

/** The form's plain text inputs — the ones a floating-label input can bind. */
type CheckoutTextFieldName = {
  [K in keyof CheckoutFormData]-?: CheckoutFormData[K] extends string | undefined
    ? K
    : never;
}[keyof CheckoutFormData];

/** Form paths for a billing address's configurable fields. */
const BILLING_FORM_FIELD = {
  firstName: "billingFirstName",
  lastName: "billingLastName",
  apartment: "billingApartment",
  postalCode: "billingPostalCode",
  state: "billingState",
  phone: "billingPhone",
} as const satisfies Record<ConfigurableAddressField, keyof CheckoutFormData>;

interface CheckoutContentProps {
  /**
   * The admin's checkout settings, server-rendered by the page so the form
   * opens with the right fields instead of re-laying itself out after a fetch.
   */
  settings: PublicCheckoutSettings;
}

export function CheckoutContent({ settings: checkoutSettings }: CheckoutContentProps) {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = params.locale as string;
  const { countryAvailability, mtnMomoPhoneExample } = useAppSettings();
  const defaultCountry = useMemo(() => {
    if (isCountryAllowed("United States", countryAvailability)) {
      return "United States";
    }
    return getAllowedCountryOptions(countryAvailability)[0]?.label || "";
  }, [countryAvailability]);
  const couponCodeFromCart = (searchParams.get("coupon") || "")
    .trim()
    .toUpperCase();

  const {
    items,
    subtotal,
    shippableSubtotal,
    totalWeight,
    refreshCart,
    removeItem,
    isLoading,
    hasShippableItems,
    hasDigitalItems,
  } = useCart();
  // Digital-only carts (ebooks, downloads) skip the shipping address and
  // shipping method entirely — only a billing address is collected, matching
  // how Shopify handles digital checkouts. The server applies the same rule.
  const isDigitalOnly = items.length > 0 && !hasShippableItems;

  const { formatPrice, currency } = useCurrency();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const collects = contactModeCollects(checkoutSettings.contact.mode);
  const { guestCheckout, signupAtCheckout } = checkoutSettings.accounts;
  // With guest checkout off, a guest's only way through is the account this
  // checkout creates for them.
  const accountRequired = !isAuthenticated && !guestCheckout && signupAtCheckout;
  const activeCustomFields = activeCheckoutCustomFields(checkoutSettings, {
    digitalOnly: isDigitalOnly,
  });

  const tr = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const issueMessage = (code: CheckoutIssueCode) => {
    switch (code) {
      case "invalid_email":
        return t("validation.email");
      case "invalid_phone":
        return tr("validation.phone", "Enter a valid phone number");
      case "invalid_number":
        return tr("validation.number", "Enter a number");
      case "invalid_date":
        return tr("validation.date", "Enter a valid date");
      case "invalid_option":
        return tr("validation.option", "Choose one of the options");
      case "too_long":
        return tr("validation.tooLong", "This answer is too long");
      default:
        return t("validation.required");
    }
  };

  const checkoutSchema = z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      contactPhone: z.string(),
      createAccount: z.boolean(),
      accountPassword: z.string(),
      customerNote: z.string(),
      // Values may be absent (a field added while this tab was open); what
      // an answer must be is the policy's call below, not the base shape's —
      // a failure here would skip the refinement and hide every other error.
      customFields: z.record(
        z.string(),
        z.union([z.string(), z.boolean()]).optional(),
      ),
      phone: z.string(),
      address: z.string(),
      apartment: z.string().optional(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string(),
      paymentMethod: z.enum([
        "card",
        "paypal",
        "razorpay",
        "paystack",
        "pesapal",
        "iotec",
        "orange_money",
        "mtn_momo",
        "cod",
      ]),
      iotecChannel: z.enum(["mobile_money", "card"]).optional(),
      iotecPhone: z.string().optional(),
      mtnMomoPhone: z.string().optional(),
      billingSameAsShipping: z.enum(["same", "different"]),
      billingFirstName: z.string(),
      billingLastName: z.string(),
      billingAddress: z.string(),
      billingApartment: z.string().optional(),
      billingCity: z.string(),
      billingState: z.string(),
      billingPostalCode: z.string(),
      billingCountry: z.string(),
      billingPhone: z.string(),
    })
    .superRefine((data, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: path.split("."),
          message,
        });
      const requireFields = (fields: Array<keyof CheckoutFormData>) => {
        for (const field of fields) {
          const value = data[field];
          if (typeof value !== "string" || !value.trim()) {
            issue(field, t("validation.required"));
          }
        }
      };
      const billingCollected =
        isDigitalOnly || data.billingSameAsShipping === "different";

      // Street, city and country: never configurable, a delivery needs them.
      if (!isDigitalOnly) requireFields([...DELIVERY_DESTINATION_FIELDS]);
      if (billingCollected) {
        requireFields(["billingAddress", "billingCity", "billingCountry"]);
      }

      // Everything the admin configured — the same evaluation the payment
      // routes run, so the form cannot accept what the server refuses.
      const { issues } = evaluateCheckoutSubmission({
        settings: checkoutSettings,
        // A guest creating an account is still a guest to the order until
        // the sign-up lands; the gate is on the form itself.
        isAuthenticated: isAuthenticated || data.createAccount || accountRequired,
        digitalOnly: isDigitalOnly,
        email: data.email,
        phone: data.contactPhone,
        accountEmail: user?.email,
        accountPhone: user?.phone,
        paymentMethod: data.paymentMethod,
        iotecChannel: data.iotecChannel,
        shippingAddress: isDigitalOnly
          ? undefined
          : {
              firstName: data.firstName,
              lastName: data.lastName,
              apartment: data.apartment,
              postalCode: data.postalCode,
              state: data.state,
              phone: data.phone,
            },
        billingAddress: billingCollected
          ? {
              firstName: data.billingFirstName,
              lastName: data.billingLastName,
              apartment: data.billingApartment,
              postalCode: data.billingPostalCode,
              state: data.billingState,
              phone: data.billingPhone,
            }
          : undefined,
        customerNote: data.customerNote,
        customFields: data.customFields,
      });
      for (const entry of issues) {
        const message = issueMessage(entry.code);
        switch (entry.scope) {
          case "contact":
            if (entry.field === "email") issue("email", message);
            else if (entry.field === "phone") issue("contactPhone", message);
            break;
          case "shipping":
            issue(entry.field, message);
            break;
          case "billing":
            issue(BILLING_FORM_FIELD[entry.field], message);
            break;
          case "custom":
            issue(`customFields.${entry.field}`, message);
            break;
          case "note":
            issue("customerNote", message);
            break;
        }
      }

      // The account this checkout creates signs in by email and password.
      if (!isAuthenticated && (data.createAccount || accountRequired)) {
        if (!data.email.trim()) issue("email", t("validation.required"));
        if (data.accountPassword.length < MIN_ALLOWED_PASSWORD_LENGTH) {
          issue(
            "accountPassword",
            tr(
              "checkout.account.passwordTooShort",
              `Use at least ${MIN_ALLOWED_PASSWORD_LENGTH} characters`,
            ),
          );
        }
      }
    });

  const { isDark } = useAppTheme();
  const stripeElementStyle = useMemo(
    () => createStripeElementStyle(isDark),
    [isDark],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Opt-in by default; only the admin's "pre-ticked" setting starts it on.
  const [emailMarketingOptIn, setEmailMarketingOptIn] = useState(
    checkoutSettings.contact.marketingOptIn.enabled &&
      checkoutSettings.contact.marketingOptIn.defaultChecked,
  );
  const [preorderAccepted, setPreorderAccepted] = useState(false);
  // Separate from the shipping acknowledgement above on purpose: one says
  // "I know this ships later", the other hands the store a card to keep.
  // Folding them together would make a payment authorisation something a
  // shopper gives away while agreeing to a delivery date.
  const [preorderMandateAccepted, setPreorderMandateAccepted] =
    useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState<{
    stripeEnabled: boolean;
    paypalEnabled: boolean;
    codEnabled: boolean;
    stripeConfigured?: boolean;
    stripePublishableKey?: string;
    paypalConfigured?: boolean;
    razorpayEnabled: boolean;
    razorpayConfigured?: boolean;
    paystackEnabled: boolean;
    paystackConfigured?: boolean;
    pesapalEnabled: boolean;
    pesapalConfigured?: boolean;
    iotecEnabled: boolean;
    iotecConfigured?: boolean;
    orangeMoneyEnabled: boolean;
    orangeMoneyConfigured?: boolean;
    mtnMomoEnabled: boolean;
    mtnMomoConfigured?: boolean;
    codInstructions?: string;
    codMinOrderAmount?: number;
    codMaxOrderAmount?: number;
  }>({
    stripeEnabled: false,
    paypalEnabled: false,
    codEnabled: true,
    stripeConfigured: false,
    paypalConfigured: false,
    razorpayEnabled: false,
    razorpayConfigured: false,
    paystackEnabled: false,
    paystackConfigured: false,
    pesapalEnabled: false,
    pesapalConfigured: false,
    iotecEnabled: false,
    iotecConfigured: false,
    orangeMoneyEnabled: false,
    orangeMoneyConfigured: false,
    mtnMomoEnabled: false,
    mtnMomoConfigured: false,
  });
  const [orderConfig, setOrderConfig] = useState<{
    taxRate: number;
    freeShippingThreshold: number;
    defaultShippingCost: number;
  }>({
    taxRate: DEFAULT_ORDER_TAX_RATE,
    freeShippingThreshold: DEFAULT_FREE_SHIPPING_THRESHOLD,
    defaultShippingCost: DEFAULT_ORDER_SHIPPING_COST,
  });
  const [shippingConfig, setShippingConfig] = useState<ShippingSettings>({
    enabled: false,
    delivery: {
      processingDaysMin: 0,
      processingDaysMax: 0,
      showEstimatedDelivery: true,
    },
    zones: [],
    fallbackRate: { enabled: false, name: "Standard", price: 0 },
  });
  const [cardholderName, setCardholderName] = useState("");
  const [stripeElementReady, setStripeElementReady] = useState(false);
  const [stripeElementError, setStripeElementError] = useState<string | null>(
    null,
  );
  const stripeRef = useRef<Stripe | null>(null);
  const stripeElementsRef = useRef<StripeElements | null>(null);
  const cardNumberElementRef = useRef<StripeCardNumberElement | null>(null);
  const cardExpiryElementRef = useRef<StripeCardExpiryElement | null>(null);
  const cardCvcElementRef = useRef<StripeCardCvcElement | null>(null);
  // Read by the mount effect without being dependencies of it. `t` is a new
  // function every time the layout re-sends its messages — which any
  // `router.refresh()` does, and the storefront refreshes on tab focus — so
  // depending on it threw away the card the shopper had already typed, and
  // mid-payment handed `confirmCardPayment` an element that no longer
  // existed ("make sure the Element you are attempting to use is mounted").
  const tRef = useRef(t);
  const stripeElementStyleRef = useRef(stripeElementStyle);
  const recoveredTokenRef = useRef<string | null>(null);
  const autoAppliedCouponRef = useRef<string | null>(null);
  const trackedCheckoutSignaturesRef = useRef<Set<string>>(new Set());
  const [cardNumberMountEl, setCardNumberMountEl] =
    useState<HTMLDivElement | null>(null);
  const [cardExpiryMountEl, setCardExpiryMountEl] =
    useState<HTMLDivElement | null>(null);
  const [cardCvcMountEl, setCardCvcMountEl] = useState<HTMLDivElement | null>(
    null,
  );
  const [checkoutStickyOffset, setCheckoutStickyOffset] = useState(112);
  // Keyed by `productId-variantId` so only the line being removed shows a
  // spinner — the rest of the summary stays interactive.
  const [removingLineKey, setRemovingLineKey] = useState<string | null>(null);
  const hasPreorderItems = useMemo(
    () => items.some((item) => item.purchaseType === "preorder"),
    [items],
  );
  // The latest of the pre-order release dates, which is what the server's
  // `getPreorderReleaseDateForOrder` picks too — the mandate text below is
  // composed on both sides and the two have to agree on their inputs.
  const preorderLatestReleaseDate = useMemo(() => {
    const dates = items
      .filter((item) => item.purchaseType === "preorder")
      .map((item) => {
        const date = item.preorderReleaseDate
          ? new Date(item.preorderReleaseDate)
          : null;
        return date && !Number.isNaN(date.getTime()) ? date : null;
      })
      .filter((date): date is Date => Boolean(date));
    if (dates.length === 0) return null;
    return dates.reduce((max, date) =>
      date.getTime() > max.getTime() ? date : max,
    );
  }, [items]);
  const preorderDateLabel = useMemo(
    () =>
      preorderLatestReleaseDate
        ? formatPreorderDate(preorderLatestReleaseDate)
        : "",
    [preorderLatestReleaseDate],
  );

  useApplyOnChange([hasPreorderItems], () => {
    if (!hasPreorderItems) setPreorderAccepted(false);
  });

  useApplyOnChange([searchParams], () => {
    if (searchParams.get("canceled") === "true") {
      setError("Payment was canceled. Please try again.");
    }
  });

  useEffect(() => {
    const token = searchParams.get("recover");
    if (!token || recoveredTokenRef.current === token) return;
    recoveredTokenRef.current = token;

    (async () => {
      try {
        const res = await fetch("/api/checkout/recover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(
            json?.message || "Recovery link is no longer available",
          );
        }
        await refreshCart();
        toast.success("Checkout restored");
        router.replace(`/${locale}/checkout`);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Recovery link is no longer available",
        );
      }
    })();
  }, [locale, refreshCart, router, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const header = document.querySelector<HTMLElement>("[data-sticky-header]");
    const updateOffset = () => {
      setCheckoutStickyOffset((header?.offsetHeight ?? 88) + 24);
    };

    updateOffset();
    window.addEventListener("resize", updateOffset);

    if (!header || typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", updateOffset);
    }

    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
    };
  }, []);

  const form = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      contactPhone: "",
      createAccount: false,
      accountPassword: "",
      customerNote: "",
      // Seeded per field so every input is controlled from the first render.
      customFields: Object.fromEntries(
        checkoutSettings.customFields.map((field) => [
          field.id,
          field.type === "checkbox" ? false : "",
        ]),
      ),
      phone: "",
      address: "",
      apartment: "",
      city: "",
      state: "",
      postalCode: "",
      country: defaultCountry,
      paymentMethod: "cod",
      iotecChannel: "mobile_money",
      iotecPhone: "",
      mtnMomoPhone: "",
      billingSameAsShipping: "same",
      billingFirstName: "",
      billingLastName: "",
      billingAddress: "",
      billingApartment: "",
      billingCity: "",
      billingState: "",
      billingPostalCode: "",
      billingCountry: defaultCountry,
      billingPhone: "",
    },
  });

  const [savedAddresses, setSavedAddresses] = useState<
    SavedCheckoutAddress[]
  >([]);
  const [savedAddressesLoaded, setSavedAddressesLoaded] = useState(false);
  const [selectedSavedAddressIndex, setSelectedSavedAddressIndex] = useState<
    number | null
  >(null);
  const [deliveryAddressMode, setDeliveryAddressMode] =
    useState<CheckoutDeliveryAddressMode>("manual");
  const deliveryFieldToFocus = useRef<
    (typeof MANUAL_DELIVERY_ADDRESS_FIELDS)[number] | null
  >(null);
  // Opt-in, not opt-out: saving is a write to the shopper's account, and a
  // pre-ticked box would file every one-time address they ever used.
  const [saveDeliveryAddress, setSaveDeliveryAddress] = useState(false);

  // A live settings refresh can narrow the policy while checkout is open.
  // Replace only now-disallowed values; valid user choices stay untouched.
  useEffect(() => {
    const shippingCountry = form.getValues("country");
    if (!isCountryAllowed(shippingCountry, countryAvailability)) {
      form.setValue("country", defaultCountry, {
        shouldDirty: Boolean(shippingCountry),
        shouldValidate: Boolean(shippingCountry),
      });
    }

    const billingCountry = form.getValues("billingCountry");
    if (!isCountryAllowed(billingCountry, countryAvailability)) {
      form.setValue("billingCountry", defaultCountry, {
        shouldDirty: Boolean(billingCountry),
        shouldValidate: Boolean(billingCountry),
      });
    }
  }, [countryAvailability, defaultCountry, form]);

  // Load account addresses once for signed-in checkout. The default is applied
  // only when it is explicit, never by treating the first historic address as
  // the shopper's current delivery choice.
  useApplyOnChange([isAuthenticated], () => {
    if (!isAuthenticated) {
      setSavedAddresses([]);
      setSelectedSavedAddressIndex(null);
      setDeliveryAddressMode("manual");
      setSavedAddressesLoaded(true);
    } else {
      setSavedAddressesLoaded(false);
    }
  });
  useEffect(() => {
    if (!isAuthenticated) return;

    const currentEmail = form.getValues("email");
    if (!currentEmail && user?.email) {
      form.setValue("email", user.email, { shouldValidate: true });
    }
    if (!form.getValues("contactPhone") && user?.phone) {
      form.setValue("contactPhone", user.phone);
    }

    // Fill name from user profile
    const { firstName: first, lastName: last } = accountRecipientName(user?.name);
    if (!form.getValues("firstName") && first) {
      form.setValue("firstName", first);
    }
    if (!form.getValues("lastName") && last) {
      form.setValue("lastName", last);
    }

    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/user/addresses");
        if (!res.ok) return;
        const json = await res.json();
        if (!active || !json?.success) return;
        const addresses = filterUsableSavedCheckoutAddresses(
          (json.data?.addresses || []) as SavedCheckoutAddress[],
        );
        setSavedAddresses(addresses);

        // An explicit account default wins. Failing that, the one saved
        // address in the city the shopper set in the header — the place they
        // said they are is a better start than an empty form, and a safer
        // one than the first historic address. Unambiguous matches only; see
        // savedAddressIndexForLocation.
        const defaultIndex =
          defaultSavedAddressIndex(addresses) ??
          savedAddressIndexForLocation(
            addresses,
            shopperLocationCity(readStoredShopperLocationFromBrowser()),
          );
        const hasManualDeliveryFields = Boolean(
          form.getValues("address") ||
            form.getValues("city") ||
            form.getValues("postalCode"),
        );
        if (defaultIndex === null || hasManualDeliveryFields) return;

        const values = savedAddressFormValues(addresses[defaultIndex]!, user?.name);
        form.setValue("firstName", values.firstName);
        form.setValue("lastName", values.lastName);
        form.setValue("address", values.address);
        form.setValue("apartment", values.apartment);
        form.setValue("city", values.city);
        form.setValue("state", values.state);
        form.setValue("postalCode", values.postalCode);
        // A saved address can predate a narrowing of the country policy —
        // only adopt its country when the store still ships there.
        if (isCountryAllowed(values.country, countryAvailability)) {
          form.setValue("country", values.country);
        }
        form.setValue("phone", values.phone);
        setSelectedSavedAddressIndex(defaultIndex);
        setDeliveryAddressMode("saved");
      } catch {
        // The manual address form remains available when account data is
        // unavailable, so a transient profile request cannot block checkout.
      } finally {
        if (active) {
          setSavedAddressesLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [countryAvailability, defaultCountry, isAuthenticated, user, form]);

  // Pre-fill the city from the place the shopper set in the header — the
  // "Deliver to" of this store — once, for a form the shopper is typing into
  // themselves. Only after the account's addresses have had their say: a city
  // written here earlier would read as a manual entry and block the saved
  // default from applying. Never for a point no reverse lookup could name,
  // whose label is a generic "Near me", and never for a download-only cart,
  // which collects no delivery address.
  const locationCityPrefilled = useRef(false);
  useEffect(() => {
    if (
      locationCityPrefilled.current ||
      authLoading ||
      !savedAddressesLoaded ||
      deliveryAddressMode !== "manual" ||
      isDigitalOnly
    ) {
      return;
    }
    locationCityPrefilled.current = true;
    if (form.getValues("city")) return;

    const city = shopperLocationCity(readStoredShopperLocationFromBrowser());
    if (city) form.setValue("city", city);
  }, [authLoading, deliveryAddressMode, form, isDigitalOnly, savedAddressesLoaded]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/public");
        const json = await res.json();
        if (!active) return;
        if (res.ok && json?.success) {
          setPaymentConfig(json.data.payment);
          setOrderConfig(json.data.orders);
          setShippingConfig(
            json.data.shipping || { enabled: false, zones: [] },
          );
          // Only the "nothing at all is set up" case is decided here. Which
          // method the form lands on is `paymentMethods` below and the effect
          // that follows it — those know what is actually rendered, including
          // the COD/digital-only rule this list has no way to see.
          const configuredAny =
            json.data.payment?.stripeConfigured ||
            json.data.payment?.paypalConfigured ||
            json.data.payment?.razorpayConfigured ||
            json.data.payment?.paystackConfigured ||
            json.data.payment?.pesapalConfigured ||
            json.data.payment?.iotecConfigured ||
            json.data.payment?.orangeMoneyConfigured ||
            json.data.payment?.mtnMomoConfigured ||
            json.data.payment?.codEnabled;
          if (!configuredAny) {
            setError(
              "No payment method is configured. Please contact support.",
            );
          }
        }
        setSettingsLoaded(true);
      } catch {
        if (!active) return;
        setPaymentConfig({
          stripeEnabled: false,
          paypalEnabled: false,
          codEnabled: true,
          stripeConfigured: false,
          paypalConfigured: false,
          razorpayEnabled: false,
          razorpayConfigured: false,
          paystackEnabled: false,
          paystackConfigured: false,
          pesapalEnabled: false,
          pesapalConfigured: false,
          iotecEnabled: false,
          iotecConfigured: false,
          orangeMoneyEnabled: false,
          orangeMoneyConfigured: false,
          mtnMomoEnabled: false,
          mtnMomoConfigured: false,
        });
        setOrderConfig({
          taxRate: DEFAULT_ORDER_TAX_RATE,
          freeShippingThreshold: DEFAULT_FREE_SHIPPING_THRESHOLD,
          defaultShippingCost: DEFAULT_ORDER_SHIPPING_COST,
        });
        setShippingConfig({ enabled: false, zones: [] });
        setSettingsLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const freeShippingThreshold =
    orderConfig.freeShippingThreshold ?? DEFAULT_FREE_SHIPPING_THRESHOLD;
  const defaultShippingCost =
    orderConfig.defaultShippingCost ?? DEFAULT_ORDER_SHIPPING_COST;
  const taxRate = orderConfig.taxRate ?? DEFAULT_ORDER_TAX_RATE;

  const [selectedShippingOptionId, setSelectedShippingOptionId] = useState<
    string | undefined
  >(undefined);
  const [vendorRateGroups, setVendorRateGroups] = useState<
    CheckoutVendorRateGroup[]
  >([]);
  const [vendorShippingSelections, setVendorShippingSelections] = useState<
    Record<string, string>
  >({});
  const [serverShippingResolution, setServerShippingResolution] =
    useState<CheckoutShippingResolution | null>(null);
  const [isShippingRateLoading, setIsShippingRateLoading] = useState(false);
  const [shippingRateFailed, setShippingRateFailed] = useState(false);
  const [shippingRateRetry, setShippingRateRetry] = useState(0);
  const [fulfillmentMethod, setFulfillmentMethod] =
    useState<CheckoutFulfillmentMethod>("delivery");
  const [pickupAvailability, setPickupAvailability] =
    useState<PickupAvailabilityState>({
      loading: true,
      eligible: false,
      locations: [],
    });
  const [selectedPickupLocationId, setSelectedPickupLocationId] =
    useState<string | null>(null);

  const watchedFirstName = useWatch({ control: form.control, name: "firstName" });
  const watchedLastName = useWatch({ control: form.control, name: "lastName" });
  const watchedAddress = useWatch({ control: form.control, name: "address" });
  const watchedApartment = useWatch({ control: form.control, name: "apartment" });
  const watchedCity = useWatch({ control: form.control, name: "city" });
  const watchedPostalCode = useWatch({ control: form.control, name: "postalCode" });
  const watchedCountry = useWatch({ control: form.control, name: "country" });
  const watchedState = useWatch({ control: form.control, name: "state" });
  const watchedPhone = useWatch({ control: form.control, name: "phone" });

  // Placeholder shown until the server quote lands (the server's answer wins
  // below, and submission is gated on it). Fed the cart's shippable subtotal
  // and real weight rather than the full subtotal and a zero: quoting a
  // weight-based rate against no weight, or a free-shipping threshold against
  // digital goods, flashed a price the order was never going to charge.
  //
  // Memoised on its inputs: the quote builds a fresh `options` array on every
  // call, and that array is a dep of the render-time adjust hook below, which
  // re-renders whenever a dep's identity changes. Re-quoting on every render
  // therefore never settled and React aborted the page with "Too many
  // re-renders" (it also re-scored every zone on each keystroke of the form).
  const shippingResult = useMemo(
    () =>
      calculateShipping({
        subtotal: shippableSubtotal,
        totalWeight,
        totalWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
        destination: {
          country: watchedCountry,
          state: watchedState,
        },
        shipping: shippingConfig,
        orders: { freeShippingThreshold, defaultShippingCost },
        selectedOptionId: selectedShippingOptionId,
      }),
    [
      shippableSubtotal,
      totalWeight,
      watchedCountry,
      watchedState,
      shippingConfig,
      freeShippingThreshold,
      defaultShippingCost,
      selectedShippingOptionId,
    ],
  );
  const shippingOptions =
    serverShippingResolution?.mode === "single"
      ? serverShippingResolution.singleOptions
      : shippingResult.options;

  // Per-vendor shipping: each vendor's items are rated separately. When active,
  // the displayed shipping cost is the sum of the selected per-vendor options.
  //
  // The server's word, not a re-derivation: `vendorRateGroups` is only ever
  // populated from a resolution whose mode was "vendor", and the payment route
  // re-resolves with the same engine. Re-checking the admin toggles here used
  // to disagree with the server when `vendorShipping.enabled` was on while the
  // master `shipping.enabled` was off — the client then displayed a
  // single-shipment price the payment route did not charge.
  const perVendorMode = vendorRateGroups.length > 0;
  const perVendorShippingCost = useMemo(() => {
    if (!perVendorMode) return 0;
    return vendorRateGroups.reduce((sum, g) => {
      const selId = vendorShippingSelections[g.vendorId] ?? g.selectedOptionId;
      const opt =
        g.options.find((o) => o.id === selId) ||
        g.options.find((o) => o.id === g.selectedOptionId);
      return sum + (opt?.cost ?? g.cost);
    }, 0);
  }, [perVendorMode, vendorRateGroups, vendorShippingSelections]);
  // Each seller's delivery as selected — what a seller's own free-shipping
  // coupon covers, priced the same way checkout will price it.
  const shippingByVendor = useMemo(() => {
    if (!perVendorMode) return undefined;
    return Object.fromEntries(
      vendorRateGroups.map((g) => {
        const selId = vendorShippingSelections[g.vendorId] ?? g.selectedOptionId;
        const opt =
          g.options.find((o) => o.id === selId) ||
          g.options.find((o) => o.id === g.selectedOptionId);
        return [g.vendorId, opt?.cost ?? g.cost];
      }),
    );
  }, [perVendorMode, vendorRateGroups, vendorShippingSelections]);

  const selectedSingleOption =
    shippingOptions.find((option) => option.id === selectedShippingOptionId) ||
    shippingOptions.find(
      (option) => option.cost === serverShippingResolution?.shippingCost,
    );
  const singleShippingCost =
    serverShippingResolution?.mode === "single"
      ? (selectedSingleOption?.cost ?? serverShippingResolution.shippingCost)
      : shippingResult.shippingCost;
  const deliveryShippingCost = perVendorMode
    ? perVendorShippingCost
    : singleShippingCost;
  const shippingCost = fulfillmentMethod === "pickup" ? 0 : deliveryShippingCost;
  // Delivery is quoted only once the shopper has said where it is going — the
  // pre-filled default country alone is not that (see hasDeliveryDestination;
  // the cart estimator holds back for the same reason). Pickup and
  // download-only carts have nothing to rate, so they never wait on a quote.
  const shippingRatesWanted =
    fulfillmentMethod === "delivery" &&
    !isDigitalOnly &&
    hasDeliveryDestination({
      address: watchedAddress,
      city: watchedCity,
      country: watchedCountry,
    });
  const shippingUnavailable =
    fulfillmentMethod === "delivery" && serverShippingResolution?.available === false;
  const shippingQuotePending = requiresFreshShippingQuote({
    hasDestination: shippingRatesWanted,
    loading: isShippingRateLoading,
    resolution: serverShippingResolution,
  });
  const pickupSelectionRequired = requiresPickupSelection({
    method: fulfillmentMethod,
    locationId: selectedPickupLocationId,
  });
  const customsDutyAmount =
    fulfillmentMethod === "pickup"
      ? 0
      : (serverShippingResolution?.customs?.dutyAmount ??
    estimateCustomsDuty({
      // Duty is estimated on what actually crosses a border, matching the
      // server — a download in the same bag owes none.
      subtotal: shippableSubtotal,
      destination: {
        country: watchedCountry,
        state: watchedState,
      },
      originCountry: shippingConfig?.origin?.country,
      customs: shippingConfig?.customs,
    }).dutyAmount);

  useEffect(() => {
    let active = true;
    (async () => {
      setPickupAvailability((current) => ({ ...current, loading: true }));
      try {
        // The place set in the header, so the branches come back nearest
        // first and the closest counter is preselected below. Read at fetch
        // time rather than held in state: it is only an input to this request.
        const origin = shopperLocationOrigin(
          readStoredShopperLocationFromBrowser(),
        );
        const response = await fetch(
          origin
            ? `/api/checkout/pickup-availability?lat=${origin.lat}&lng=${origin.lng}`
            : "/api/checkout/pickup-availability",
        );
        const json = await response.json().catch(() => null);
        if (!active) return;
        if (response.ok && json?.success) {
          const locations = Array.isArray(json.data?.locations)
            ? (json.data.locations as CheckoutPickupLocation[])
            : [];
          setPickupAvailability({
            loading: false,
            eligible: Boolean(json.data?.eligible),
            reason: json.data?.reason,
            vendor: json.data?.vendor,
            locations,
          });
          // Only branches that hold the whole basket count, so a selection
          // made before an item was added is dropped rather than carried
          // into a payment the server would refuse; the nearest usable one
          // is chosen when the shopper's place is known. See the resolver.
          setSelectedPickupLocationId((current) =>
            resolveInitialPickupLocationId(locations, current),
          );
        } else {
          setPickupAvailability({
            loading: false,
            eligible: false,
            locations: [],
                });
          setSelectedPickupLocationId(null);
        }
      } catch {
        if (active) {
          setPickupAvailability({
            loading: false,
            eligible: false,
            locations: [],
                });
          setSelectedPickupLocationId(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [items]);

  // Keep the selected option valid as address/cart changes the available rates.
  useApplyOnChange([shippingOptions, selectedShippingOptionId], () => {
    if (
      selectedShippingOptionId &&
      !shippingOptions.some((o) => o.id === selectedShippingOptionId)
    ) {
      setSelectedShippingOptionId(undefined);
    }
  });

  // Fetch authoritative product/variant-aware rates for both single and
  // per-vendor carts. The server normalizes weight units and excludes digital
  // items before selecting rates. The request only runs while
  // `shippingRatesWanted`.
  useApplyOnChange(
    [
      items,
      watchedCountry,
      watchedState,
      shippingRateRetry,
      fulfillmentMethod,
      isDigitalOnly,
      shippingRatesWanted,
    ],
    () => {
      if (!shippingRatesWanted) {
        setVendorRateGroups([]);
        setServerShippingResolution(null);
        setIsShippingRateLoading(false);
        setShippingRateFailed(false);
        return;
      }
      // Stale-while-revalidate: the previous quote stays rendered (dimmed,
      // with submit blocked via shippingQuotePending) instead of being torn
      // down into a spinner. Destroying the cards here was the page's worst
      // layout shift — six rate cards collapsing to one spinner row and back
      // dragged the whole payment column up and down on every address edit.
      setIsShippingRateLoading(true);
      setShippingRateFailed(false);
    },
  );
  useEffect(() => {
    if (!shippingRatesWanted) return;

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/checkout/shipping-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            country: watchedCountry,
            state: watchedState,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (res.ok && data?.success) {
          const resolution = data.data as CheckoutShippingResolution & {
            vendorGroups?: CheckoutVendorRateGroup[];
          };
          setServerShippingResolution(resolution);
          setVendorRateGroups(
            resolution.mode === "vendor" ? resolution.vendorGroups || [] : [],
          );
          setIsShippingRateLoading(false);
        } else {
          setVendorRateGroups([]);
          setServerShippingResolution(null);
          setIsShippingRateLoading(false);
          setShippingRateFailed(true);
        }
      } catch {
        if (active) {
          setVendorRateGroups([]);
          setServerShippingResolution(null);
          setIsShippingRateLoading(false);
          setShippingRateFailed(true);
        }
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    // Everything the server actually rates on: the cart contents and the
    // country/state pair sent in the body. The other six address fields used
    // to be here via a composite quote key, which re-fetched (and flashed the
    // spinner) on every keystroke of a street or phone number that cannot
    // change the rate.
    items,
    watchedCountry,
    watchedState,
    shippingRateRetry,
    fulfillmentMethod,
    isDigitalOnly,
    shippingRatesWanted,
  ]);

  const clearShippingQuote = () => {
    setSelectedShippingOptionId(undefined);
    setVendorShippingSelections({});
    setVendorRateGroups([]);
    setServerShippingResolution(null);
  };

  const changeFulfillmentMethod = (method: CheckoutFulfillmentMethod) => {
    setFulfillmentMethod(method);
    // Only the delivery quote is dropped. The payment method is deliberately
    // left alone: switching to collection used to force COD, which meant a
    // shopper who had already chosen to pay by card silently had it taken back,
    // and a store with COD off could not complete a pickup order at all.
    if (method === "pickup") clearShippingQuote();
  };

  const changePickupLocation = (locationId: string) => {
    if (locationId === selectedPickupLocationId) return;
    setSelectedPickupLocationId(locationId);
    setError(null);
  };

  const applySavedAddress = (index: number) => {
    const address = savedAddresses[index];
    if (!address) return;

    const values = savedAddressFormValues(address, user?.name);
    form.setValue("firstName", values.firstName, { shouldValidate: true });
    form.setValue("lastName", values.lastName, { shouldValidate: true });
    form.setValue("address", values.address, { shouldValidate: true });
    form.setValue("apartment", values.apartment, { shouldValidate: true });
    form.setValue("city", values.city, { shouldValidate: true });
    form.setValue("state", values.state, { shouldValidate: true });
    form.setValue("postalCode", values.postalCode, { shouldValidate: true });
    form.setValue("country", values.country, { shouldValidate: true });
    form.setValue("phone", values.phone, { shouldValidate: true });
    setSelectedSavedAddressIndex(index);
    setDeliveryAddressMode("saved");
    // No quote teardown here. Rates are a pure function of country/state and
    // the cart, so switching between two addresses in the same region keeps
    // the current quote valid as-is; when either really changes the fetch
    // effect reacts on its own. Clearing here used to combine with a manual
    // loading=true into a spinner that nothing would ever resolve when the
    // effect's inputs hadn't changed.
  };

  const useOneTimeAddress = () => {
    form.setValue("firstName", "", { shouldValidate: true });
    form.setValue("lastName", "", { shouldValidate: true });
    form.setValue("address", "", { shouldValidate: true });
    form.setValue("apartment", "", { shouldValidate: true });
    form.setValue("city", "", { shouldValidate: true });
    form.setValue("state", "", { shouldValidate: true });
    form.setValue("postalCode", "", { shouldValidate: true });
    form.setValue("country", "", { shouldValidate: true });
    form.setValue("phone", "", { shouldValidate: true });
    setSelectedSavedAddressIndex(null);
    setDeliveryAddressMode("manual");
    clearShippingQuote();
    setIsShippingRateLoading(false);
    setShippingRateFailed(false);
  };
  const chooseSavedAddress = () => {
    setSelectedSavedAddressIndex(null);
    setDeliveryAddressMode("saved");
  };

  // Removing a line from the summary must not tear the page down: `removeItem`
  // ends in a non-silent `refreshCart`, which flips the cart's isLoading and
  // would swap the whole checkout for the skeleton, wiping the form the shopper
  // has already filled in. So drop the line locally, then reconcile quietly.
  const handleRemoveLine = async (
    lineKey: string,
    productId: string,
    variantId?: string,
  ) => {
    if (removingLineKey) return;
    setRemovingLineKey(lineKey);
    try {
      await removeItem(productId, variantId, { silent: true });
      // A coupon qualified against the old basket may no longer apply once a
      // line is gone, and the total must never quote a discount the order
      // would not get. Clearing it makes the shopper re-apply against the new
      // subtotal, which is the only basket the server will honour.
      setAppliedCoupon(null);
      toast.success(t("cart.itemRemoved"));
    } catch (error) {
      console.error("Failed to remove checkout line:", error);
      toast.error(t("common.error"));
    } finally {
      setRemovingLineKey(null);
    }
  };

  const couponCartItems = useMemo(
    () =>
      items.map((item) => {
        const checkoutItem = item as CheckoutCartItem;
        return {
          productId: getCheckoutProductId(checkoutItem.productId),
          price: checkoutItem.price,
          quantity: checkoutItem.quantity,
          categoryId: checkoutItem.categoryId
            ? String(checkoutItem.categoryId)
            : undefined,
        };
      }),
    [items],
  );
  const totals = calculateCheckoutTotals({
    subtotal,
    shippingCost,
    taxRate,
    coupon: appliedCoupon,
    shippingByVendor,
    currency: currency.code,
  });
  const discount = totals.subtotalDiscount;
  const shippingDiscount = totals.shippingDiscount;
  const discountedShippingCost = totals.discountedShippingCost;
  const tax = totals.tax;
  const total = totals.total + customsDutyAmount;
  // What each pre-order line leaves for later once the coupon is shared
  // between its deposit and its balance — the split checkout charges by.
  const preorderOutstandingByLine = hasPreorderItems
    ? preorderOutstandingAfterCoupon(
        items.map((item) => ({
          price: item.price,
          quantity: item.quantity,
          purchaseType: item.purchaseType,
          preorderOutstandingAmount: item.preorderOutstandingAmount,
          vendorId: item.vendorId ?? null,
        })),
        {
          goodsDiscount: totals.subtotalDiscount,
          vendorShares: appliedCoupon?.vendorShares,
        },
        currency.code,
      )
    : [];
  const preorderOutstandingAmount = preorderOutstandingByLine.reduce(
    (sum, value) => sum + value,
    0,
  );
  const preorderDueNow = Math.max(0, total - preorderOutstandingAmount);
  const appliedCouponForDisplay = appliedCoupon
    ? {
        ...appliedCoupon,
        discount: isFreeShippingCouponType(appliedCoupon.type)
          ? shippingDiscount
          : discount,
      }
    : null;
  const deliveryEstimate =
    !perVendorMode &&
    shippingConfig?.enabled &&
    shippingConfig?.delivery?.showEstimatedDelivery &&
    shippingOptions.length > 0
      ? selectedSingleOption?.deliveryDays
      : undefined;
  const checkoutAnalyticsSignature = useMemo(
    () =>
      items
        .map(
          (item) =>
            `${String(item.productId)}:${String(item.variantId || "")}:${
              item.quantity
            }`,
        )
        .join("|"),
    [items],
  );

  useEffect(() => {
    if (!items.length || !checkoutAnalyticsSignature) return;
    if (trackedCheckoutSignaturesRef.current.has(checkoutAnalyticsSignature)) {
      return;
    }

    trackedCheckoutSignaturesRef.current.add(checkoutAnalyticsSignature);

    trackCheckout({
      currency: currency.code,
      value: total,
      items: analyticsItemsFromCart(items),
    });
  }, [checkoutAnalyticsSignature, currency.code, items, total]);

  useApplyOnChange([appliedCoupon, shippingCost], () => {
    if (
      appliedCoupon &&
      isFreeShippingCouponType(appliedCoupon.type) &&
      shippingCost <= 0
    ) {
      setAppliedCoupon(null);
    }
  });

  useEffect(() => {
    if (!settingsLoaded || !couponCodeFromCart || !items.length) return;
    if (appliedCoupon?.code?.toUpperCase() === couponCodeFromCart) return;
    if (autoAppliedCouponRef.current === couponCodeFromCart) return;

    autoAppliedCouponRef.current = couponCodeFromCart;
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/coupons/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: couponCodeFromCart,
            cartItems: couponCartItems,
            subtotal,
            shippingCost,
            ...(shippingByVendor ? { shippingByVendor } : {}),
          }),
        });
        const data = await res.json().catch(() => null);

        if (!active) return;
        if (!res.ok || !data?.success) {
          throw new Error(
            getCouponErrorMessage(
              data,
              t("coupon.invalid"),
            ),
          );
        }

        setAppliedCoupon({
          code: data.data.code,
          discount: data.data.discount,
          type: data.data.type,
          discountTarget: data.data.discountTarget,
          maxDiscount: data.data.maxDiscount,
          vendorShares: data.data.vendorShares,
          shippingVendorId: data.data.shippingVendorId,
        });
      } catch (error) {
        if (!active) return;
        toast.error(
          error instanceof Error
            ? error.message
            : t("coupon.invalid"),
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [
    appliedCoupon?.code,
    couponCartItems,
    couponCodeFromCart,
    shippingByVendor,
    items.length,
    settingsLoaded,
    shippingCost,
    subtotal,
    t,
  ]);

  const trackAbandonedCheckout = checkoutSettings.abandonedCheckouts.enabled;
  useEffect(() => {
    // Switched off in the checkout settings: nothing about this checkout is
    // recorded for recovery.
    if (!items.length || !trackAbandonedCheckout) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: ({ values: value }) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const email = typeof value.email === "string" ? value.email.trim() : "";
        const phone =
          (typeof value.contactPhone === "string" && value.contactPhone.trim()) ||
          (typeof value.phone === "string" ? value.phone.trim() : "");
        if (!email && !phone) return;

        const shippingAddress = buildCheckoutAddressPayload({
          firstName: value.firstName,
          lastName: value.lastName,
          address: value.address,
          apartment: value.apartment,
          city: value.city,
          state: value.state,
          postalCode: value.postalCode,
          country: value.country,
          phone,
        });
        const billingAddress =
          value.billingSameAsShipping === "different"
            ? buildCheckoutAddressPayload(
                {
                  firstName: value.billingFirstName,
                  lastName: value.billingLastName,
                  address: value.billingAddress,
                  apartment: value.billingApartment,
                  city: value.billingCity,
                  state: value.billingState,
                  postalCode: value.billingPostalCode,
                  country: value.billingCountry,
                  phone: value.billingPhone,
                },
                phone,
              )
            : shippingAddress;

        void fetch("/api/checkout/abandoned", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locale,
            email,
            phone,
            customerName: shippingAddress.fullName,
            buyerAcceptsMarketing: emailMarketingOptIn,
            shippingAddress,
            billingAddress,
            subtotalPrice: subtotal,
            shippingPrice: discountedShippingCost,
            totalTax: tax,
            totalDiscounts: totals.discount,
            totalPrice: total,
            presentmentCurrency: currency.code,
          }),
        }).catch(() => undefined);
      }, 900);
      },
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [
    currency.code,
    discountedShippingCost,
    emailMarketingOptIn,
    form,
    items.length,
    locale,
    subtotal,
    tax,
    total,
    totals.discount,
    trackAbandonedCheckout,
  ]);

  const watchedEmail = useWatch({ control: form.control, name: "email" });
  const watchedCreateAccount = useWatch({
    control: form.control,
    name: "createAccount",
  });
  const contactLabel = user?.email || watchedEmail;
  const contactInitial = String(user?.name || contactLabel || "C")
    .trim()
    .slice(0, 1)
    .toUpperCase();

  const shippingMethodName =
    shippingResult.source === "shipping"
      ? (() => {
          const zones = Array.isArray(shippingConfig?.zones)
            ? shippingConfig.zones
            : [];
          const rateId = shippingResult.rateId;
          for (const zone of zones) {
            const rates = Array.isArray(zone?.rates) ? zone.rates : [];
            const match = rates.find((rate) => rate?.id === rateId);
            if (match?.name) return String(match.name);
          }
          const fallbackName = shippingConfig?.fallbackRate?.name;
          return fallbackName ? String(fallbackName) : "Standard";
        })()
      : "Standard";

  const selectedPayment = useWatch({ control: form.control, name: "paymentMethod" });
  // The sentence the shopper agrees to, built by the same function the server
  // uses to compose the copy it stores on the order — so the record is of what
  // was actually on screen. See `lib/payments/preorder-mandate.ts`.
  //
  // Asked of anyone paying by card, signed in or not: a guest's card is kept on
  // a Customer minted for their checkout, so a guest's say-so is needed exactly
  // like anybody else's. Not asked at all for any other method — nothing is
  // kept, so a sentence about keeping a card would be permission for nothing.
  // The server applies the identical rule (`savesCard` in deferred-balance.ts).
  // Declared after `selectedPayment`, which it reads.
  const needsPreorderMandate =
    preorderMandateRequired(preorderOutstandingAmount) &&
    selectedPayment === "card";
  const preorderMandateText = useMemo(
    () =>
      needsPreorderMandate
        ? buildPreorderMandateText({
            outstandingAmount: preorderOutstandingAmount,
            currency: currency.code,
            releaseDate: preorderLatestReleaseDate,
          })
        : "",
    [
      needsPreorderMandate,
      preorderOutstandingAmount,
      currency.code,
      preorderLatestReleaseDate,
    ],
  );
  // A cart that stops owing anything later — or a shopper who switches away
  // from card — must not carry a card authorisation nobody is being shown.
  useApplyOnChange([needsPreorderMandate], () => {
    if (!needsPreorderMandate) setPreorderMandateAccepted(false);
  });
  const selectedIotecChannel =
    useWatch({ control: form.control, name: "iotecChannel" }) || "mobile_money";
  const watchedBillingCountry = useWatch({
    control: form.control,
    name: "billingCountry",
  });
  const billingAddressMode = useWatch({
    control: form.control,
    name: "billingSameAsShipping",
  });

  const stripePublishableKey = paymentConfig.stripePublishableKey;
  const stripeMountWanted = selectedPayment === "card" && Boolean(stripePublishableKey);
  // The elements are torn down below the moment Stripe stops being the
  // method, so "ready" and its error cannot outlive that decision.
  useApplyOnChange([stripeMountWanted], () => {
    if (!stripeMountWanted) {
      setStripeElementReady(false);
      setStripeElementError(null);
    }
  });
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    stripeElementStyleRef.current = stripeElementStyle;
    // Restyled in place on a theme switch. Tearing the elements down and
    // building them again would clear the card number mid-form.
    cardNumberElementRef.current?.update({ style: stripeElementStyle });
    cardExpiryElementRef.current?.update({ style: stripeElementStyle });
    cardCvcElementRef.current?.update({ style: stripeElementStyle });
  }, [stripeElementStyle]);

  useEffect(() => {
    const publishableKey = stripePublishableKey;
    if (!stripeMountWanted || !publishableKey) {
      cardNumberElementRef.current?.destroy();
      cardExpiryElementRef.current?.destroy();
      cardCvcElementRef.current?.destroy();
      cardNumberElementRef.current = null;
      cardExpiryElementRef.current = null;
      cardCvcElementRef.current = null;
      stripeElementsRef.current = null;
      stripeRef.current = null;
      return;
    }

    // Wait for mount elements to be available - effect will re-run when they're set
    if (!cardNumberMountEl || !cardExpiryMountEl || !cardCvcMountEl) {
      return;
    }

    let active = true;
    (async () => {
      try {
        const stripe = await loadStripe(publishableKey);
        if (!active) return;
        if (!stripe) {
          setStripeElementError("Stripe is not configured");
          setStripeElementReady(false);
          return;
        }

        stripeRef.current = stripe;

        // Always destroy old elements before creating new ones
        // (mount divs may have changed due to conditional rendering)
        cardNumberElementRef.current?.destroy();
        cardExpiryElementRef.current?.destroy();
        cardCvcElementRef.current?.destroy();
        cardNumberElementRef.current = null;
        cardExpiryElementRef.current = null;
        cardCvcElementRef.current = null;

        const elements = stripe.elements();
        stripeElementsRef.current = elements;

        const style = stripeElementStyleRef.current;
        const translate = tRef.current;
        const cardNumber = elements.create("cardNumber", {
          style,
          showIcon: false,
          placeholder: translate("payment.cardNumber"),
        });
        const cardExpiry = elements.create("cardExpiry", {
          style,
          placeholder: translate("payment.expiryDate"),
        });
        const cardCvc = elements.create("cardCvc", {
          style,
          placeholder: translate("payment.cvv"),
        });

        cardNumber.on("change", (ev) => {
          setStripeElementError(ev.error?.message || null);
        });
        cardExpiry.on("change", (ev) => {
          setStripeElementError(ev.error?.message || null);
        });
        cardCvc.on("change", (ev) => {
          setStripeElementError(ev.error?.message || null);
        });

        if (!active) {
          cardNumber.destroy();
          cardExpiry.destroy();
          cardCvc.destroy();
          return;
        }

        cardNumber.mount(cardNumberMountEl);
        cardExpiry.mount(cardExpiryMountEl);
        cardCvc.mount(cardCvcMountEl);

        cardNumberElementRef.current = cardNumber;
        cardExpiryElementRef.current = cardExpiry;
        cardCvcElementRef.current = cardCvc;
        setStripeElementReady(true);
        setStripeElementError(null);
      } catch (err: unknown) {
        if (!active) return;
        console.error("Stripe Element initialization failed:", err);
        setStripeElementError(
          err instanceof Error ? err.message : "Failed to load payment form",
        );
        setStripeElementReady(false);
      }
    })();

    return () => {
      active = false;
      // Destroy elements on cleanup so fresh ones are created on re-mount
      cardNumberElementRef.current?.destroy();
      cardExpiryElementRef.current?.destroy();
      cardCvcElementRef.current?.destroy();
      cardNumberElementRef.current = null;
      cardExpiryElementRef.current = null;
      cardCvcElementRef.current = null;
    };
  }, [
    cardNumberMountEl,
    cardExpiryMountEl,
    cardCvcMountEl,
    stripeMountWanted,
    stripePublishableKey,
  ]);

  // Build enabled payment methods list
  const paymentMethods = useMemo(() => {
    const methods: {
      value: CheckoutFormData["paymentMethod"];
      label: string;
      icon: typeof CreditCard;
      detail: string;
    }[] = [];
    if (
      paymentConfig.stripeEnabled &&
      paymentConfig.stripeConfigured !== false
    ) {
      methods.push({
        value: "card",
        label: t("checkout.card"),
        icon: CreditCard,
        detail: t("checkout.payment.cardDetailsParams"),
      });
    }
    if (
      paymentConfig.paypalEnabled &&
      paymentConfig.paypalConfigured !== false
    ) {
      methods.push({
        value: "paypal",
        label: "PayPal",
        icon: Wallet,
        detail: t("checkout.payment.paypalRedirect"),
      });
    }
    if (
      paymentConfig.razorpayEnabled &&
      paymentConfig.razorpayConfigured !== false
    ) {
      methods.push({
        value: "razorpay",
        label: "Razorpay",
        icon: Wallet,
        detail: t("checkout.payment.razorpayRedirect"),
      });
    }
    if (
      paymentConfig.paystackEnabled &&
      paymentConfig.paystackConfigured !== false
    ) {
      methods.push({
        value: "paystack",
        label: "Paystack",
        icon: Wallet,
        detail: t("checkout.payment.paystackRedirect"),
      });
    }
    if (
      paymentConfig.pesapalEnabled &&
      paymentConfig.pesapalConfigured !== false
    ) {
      methods.push({
        value: "pesapal",
        label: "Pesapal",
        icon: Wallet,
        detail: t("checkout.payment.pesapalRedirect"),
      });
    }
    if (paymentConfig.iotecEnabled && paymentConfig.iotecConfigured !== false) {
      methods.push({
        value: "iotec",
        label: "ioTec Pay",
        icon: Smartphone,
        detail: t("checkout.payment.iotecDetail"),
      });
    }
    if (
      paymentConfig.orangeMoneyEnabled &&
      paymentConfig.orangeMoneyConfigured !== false
    ) {
      methods.push({
        value: "orange_money",
        label: "Orange Money",
        icon: Smartphone,
        detail: t("checkout.payment.orangeMoneyRedirect"),
      });
    }
    if (
      paymentConfig.mtnMomoEnabled &&
      paymentConfig.mtnMomoConfigured !== false
    ) {
      methods.push({
        value: "mtn_momo",
        label: "MTN Mobile Money",
        icon: Smartphone,
        detail: t("checkout.payment.mtnMomoDetail"),
      });
    }
    // COD needs a hand-over to collect the cash at — a courier or a counter.
    // Digital files have neither: they release off the order itself, before
    // any cash could be collected. That rules COD out for any cart carrying a
    // digital line, mixed carts included — not just downloads-only carts,
    // where the money would never change hands at all. Pre-orders are out for
    // the mirror-image reason: the seller commits stock at reservation time
    // and the deposit/pay-later maths assume money moves NOW, while COD
    // collects only at a door weeks away — a deposit pre-order on COD would
    // reserve units having collected nothing. The server refuses both; this
    // only keeps the option off the screen.
    if (
      paymentConfig.codEnabled &&
      !hasDigitalItems &&
      !hasPreorderItems
    ) {
      // "Cash on delivery" is the wrong words for an order nobody delivers, so
      // collection renames it to what actually happens: the shopper pays at the
      // counter when they turn up. Same payment method, same server handling —
      // only the sentence and the icon change.
      const collecting = fulfillmentMethod === "pickup";
      methods.push({
        value: "cod",
        label: collecting
          ? t.has("checkout.payAtCounter")
            ? t("checkout.payAtCounter")
            : "Pay at the counter"
          : t("checkout.cod"),
        icon: collecting ? Wallet : Truck,
        detail: collecting
          ? t.has("checkout.payment.payAtCounterDescription")
            ? t("checkout.payment.payAtCounterDescription")
            : "Pay when you collect your order."
          : paymentConfig.codInstructions ||
            t("checkout.payment.payOnDeliveryDescription"),
      });
    }
    // Note there is no collection-specific narrowing of `methods` below.
    // Filtering it down to COD for pickup is what made collection unreachable in
    // a prepaid-only store, and a prepaid collection is the safer of the two
    // orders — see `pickupAvailable`.
    return methods;
  }, [paymentConfig, fulfillmentMethod, hasDigitalItems, hasPreorderItems, t]);

  // Keep the selection inside what is actually on offer. The form opens on COD
  // and a live settings refresh can narrow the list, so the selected method can
  // end up being one the shopper can no longer see — including COD on a cart
  // that turned out to carry a digital item.
  useEffect(() => {
    if (paymentMethods.length === 0) return;
    const current = form.getValues("paymentMethod");
    if (paymentMethods.some((method) => method.value === current)) return;
    form.setValue("paymentMethod", paymentMethods[0].value);
  }, [paymentMethods, form]);

  // A store whose only method is COD has nothing left to charge a downloads-only
  // cart with, so say that instead of rendering an empty radio group.
  const noPaymentMethodAvailable = settingsLoaded && paymentMethods.length === 0;

  const redirectPaymentProvider = (
    ["paypal", "razorpay", "paystack", "pesapal", "orange_money"] as const
  ).includes(
    selectedPayment as
      | "paypal"
      | "razorpay"
      | "paystack"
      | "pesapal"
      | "orange_money",
  )
    ? (selectedPayment as
        | "paypal"
        | "razorpay"
        | "paystack"
        | "pesapal"
        | "orange_money")
    : null;
  const redirectPaymentProviderName = redirectPaymentProvider
    ? paymentMethods.find((method) => method.value === redirectPaymentProvider)
        ?.label || redirectPaymentProvider
    : "";
  const checkoutSummaryStyle = {
    "--checkout-summary-offset": `${checkoutStickyOffset}px`,
  } as CSSProperties;

  const onSubmit = async (data: CheckoutFormData) => {
    setIsSubmitting(true);
    setError(null);
    // Once the order is in, the button keeps spinning until the success page
    // replaces this one, rather than flipping back to a live "Complete order"
    // over a cart the server has already emptied. The success page re-reads
    // the cart, so nothing is cleared here to hold the hand-off up.
    let handedOff = false;
    const goToSuccess = (href: string) => {
      handedOff = true;
      router.push(href);
    };
    // A payment route refused because a price moved since this summary was
    // drawn; nothing was charged. The cart already holds the new prices, so it
    // is re-read quietly (a loud refresh would swap the filled-in form for the
    // skeleton) and the summary shows the total the shopper would really pay.
    // A coupon goes too, as it does when a line is removed: its discount was
    // worked out on the old prices and the total must not quote it.
    const pricesChangedError = async () => {
      const hadCoupon = Boolean(appliedCoupon);
      await refreshCart(true).catch((err) =>
        console.error("Failed to re-read the cart after a price change:", err),
      );
      if (hadCoupon) setAppliedCoupon(null);
      return new Error(
        hadCoupon
          ? t("checkout.pricesChangedCouponRemoved")
          : t("checkout.pricesChanged"),
      );
    };

    try {
      if (pickupSelectionRequired) {
        throw new Error("Select and reserve a pickup time before payment");
      }
      if (fulfillmentMethod === "delivery" && shippingUnavailable) {
        throw new Error(SHIPPING_UNAVAILABLE_MESSAGE);
      }
      if (fulfillmentMethod === "delivery" && shippingRateFailed) {
        throw new Error(
          t.has("checkout.shippingRateFailed")
            ? t("checkout.shippingRateFailed")
            : "We couldn't update shipping rates. Check the address and try again.",
        );
      }
      if (fulfillmentMethod === "delivery" && shippingQuotePending) {
        throw new Error(
          t.has("checkout.shippingUpdating")
            ? t("checkout.shippingUpdating")
            : "Updating shipping rates…",
        );
      }
      if (
        data.paymentMethod === "card" &&
        paymentConfig.stripeConfigured === false
      ) {
        throw new Error("Stripe is not configured");
      }
      if (
        data.paymentMethod === "paypal" &&
        paymentConfig.paypalConfigured === false
      ) {
        throw new Error("PayPal is not configured");
      }
      if (
        data.paymentMethod === "razorpay" &&
        paymentConfig.razorpayConfigured === false
      ) {
        throw new Error("Razorpay is not configured");
      }
      if (
        data.paymentMethod === "paystack" &&
        paymentConfig.paystackConfigured === false
      ) {
        throw new Error("Paystack is not configured");
      }
      if (
        data.paymentMethod === "pesapal" &&
        paymentConfig.pesapalConfigured === false
      ) {
        throw new Error("Pesapal is not configured");
      }
      if (
        data.paymentMethod === "iotec" &&
        paymentConfig.iotecConfigured === false
      ) {
        throw new Error("ioTec Pay is not configured");
      }
      // Card collections are billed to the email instead, so the mobile money
      // number is only required on the mobile money channel.
      if (
        data.paymentMethod === "iotec" &&
        data.iotecChannel !== "card" &&
        !String(data.iotecPhone || "").trim()
      ) {
        throw new Error("Please enter your mobile money number");
      }
      if (
        data.paymentMethod === "mtn_momo" &&
        paymentConfig.mtnMomoConfigured === false
      ) {
        throw new Error("MTN MoMo is not configured");
      }
      if (
        data.paymentMethod === "mtn_momo" &&
        !String(data.mtnMomoPhone || "").trim()
      ) {
        throw new Error("Please enter your mobile money number");
      }
      if (data.paymentMethod === "cod" && paymentConfig.codEnabled === false) {
        throw new Error("Cash on Delivery is disabled");
      }
      if (data.paymentMethod === "cod" && hasDigitalItems) {
        throw new Error(
          "Cash on Delivery is not available for orders that include digital items",
        );
      }
      if (data.paymentMethod === "cod" && hasPreorderItems) {
        throw new Error(
          "Cash on Delivery is not available for pre-order items",
        );
      }
      if (hasPreorderItems && !preorderAccepted) {
        throw new Error("Please confirm the pre-order shipping terms");
      }
      if (needsPreorderMandate && !preorderMandateAccepted) {
        throw new Error(
          "Please authorise the remaining balance to be charged to your card when your pre-order ships",
        );
      }

      // "Create an account": signed up before payment, so the order belongs
      // to the account from the start. The session the sign-up opens is picked
      // up by the requests below; the cart refresh (silent — a loading flip
      // would unmount the card fields) folds the guest cart into the account's.
      let placingAsGuest = !isAuthenticated;
      if (!isAuthenticated && (data.createAccount || accountRequired)) {
        const accountName =
          `${data.firstName} ${data.lastName}`.trim() ||
          `${data.billingFirstName} ${data.billingLastName}`.trim() ||
          data.email.split("@")[0];
        const signUpResult = await signUp.email({
          name: accountName,
          email: data.email.trim(),
          password: data.accountPassword,
          callbackURL: `/${locale}/email-verified`,
          ...(data.contactPhone.trim() ? { phone: data.contactPhone.trim() } : {}),
        } as Parameters<typeof signUp.email>[0]);
        if (signUpResult.error) {
          const code = (signUpResult.error as { code?: string }).code || "";
          throw new Error(
            /USER_ALREADY_EXISTS/i.test(code)
              ? tr(
                  "checkout.account.exists",
                  "An account with this email already exists. Log in, or untick “Create an account”.",
                )
              : signUpResult.error.message || t("common.error"),
          );
        }
        const signedIn = Boolean(
          (signUpResult.data as { token?: string | null } | null)?.token,
        );
        if (signedIn) {
          placingAsGuest = false;
          await refreshCart(true);
        } else if (!guestCheckout) {
          // The store verifies emails first, and takes no guest orders.
          toast.success(
            tr(
              "checkout.account.verifyFirst",
              "Account created. Verify your email, then log in to finish your order.",
            ),
          );
          return;
        } else {
          toast.success(
            tr(
              "checkout.account.verifyLater",
              "Account created — verify your email to see this order in it.",
            ),
          );
        }
      }

      // Only the answers to fields this checkout actually shows; the server
      // drops anything else regardless.
      const customFieldValues = Object.fromEntries(
        activeCustomFields
          .map((field) => [field.id, data.customFields?.[field.id]] as const)
          .filter(([, value]) => value !== undefined && value !== ""),
      );
      const contactPayload = {
        phone: data.contactPhone.trim() || undefined,
        customerNote:
          checkoutSettings.orderNote.visibility !== "hidden"
            ? data.customerNote.trim() || undefined
            : undefined,
        customFields:
          Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
      };

      const shippingAddress = buildCheckoutAddressPayload(
        {
          firstName: data.firstName,
          lastName: data.lastName,
          address: data.address,
          apartment: data.apartment,
          city: data.city,
          state: data.state,
          postalCode: data.postalCode,
          country: data.country,
          phone: data.phone,
        },
        data.contactPhone.trim() || user?.phone || "",
      );
      const billingAddress =
        isDigitalOnly || data.billingSameAsShipping === "different"
          ? buildCheckoutAddressPayload(
              {
                firstName: data.billingFirstName,
                lastName: data.billingLastName,
                address: data.billingAddress,
                apartment: data.billingApartment,
                city: data.billingCity,
                state: data.billingState,
                postalCode: data.billingPostalCode,
                country: data.billingCountry,
                phone: data.billingPhone,
              },
              shippingAddress.phone || "",
            )
          : shippingAddress;
      const checkoutAnalyticsPayload = {
        currency: currency.code,
        value: total,
        paymentMethod: data.paymentMethod,
        items: analyticsItemsFromCart(items),
      };

      saveCheckoutAnalyticsSnapshot(checkoutAnalyticsPayload);
      trackPaymentInfo(checkoutAnalyticsPayload);
      // A guest has no session for the success page to download the invoice
      // with, so it verifies through the public tracking endpoint instead —
      // which needs the email this order is about to be placed under.
      if (placingAsGuest) {
        // The public invoice lookup matches either; the email is the better key.
        saveGuestCheckoutEmail(data.email.trim() || data.contactPhone);
      }

      // What placing the order looks like, whichever way it is paid for. Shared
      // because the card path can end up here too: a pre-order with nothing to
      // pay today is placed through this endpoint after its card is set up.
      const checkoutPayload = {
        shippingAddress: isDigitalOnly ? undefined : shippingAddress,
        billingAddress,
        paymentMethod: data.paymentMethod,
        email: data.email.trim() || undefined,
        ...contactPayload,
        couponCode: appliedCoupon?.code,
        locale,
        fulfillmentMethod,
        pickupLocationId: selectedPickupLocationId ?? undefined,
        selectedShippingOptionId,
        vendorShippingSelections: perVendorMode
          ? vendorShippingSelections
          : undefined,
        preorderAcknowledged: hasPreorderItems ? preorderAccepted : undefined,
        preorderMandateAccepted: needsPreorderMandate
          ? preorderMandateAccepted
          : undefined,
      };

      if (
        data.paymentMethod === "card" &&
        paymentConfig.stripeEnabled &&
        paymentConfig.stripeConfigured !== false &&
        paymentConfig.stripePublishableKey
      ) {
        const stripe = stripeRef.current;
        if (!stripe || !cardNumberElementRef.current || !stripeElementReady) {
          throw new Error("Stripe is not ready");
        }

        const intentRes = await fetch("/api/payments/stripe/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shippingAddress: isDigitalOnly ? undefined : shippingAddress,
            billingAddress,
            locale,
            email: data.email.trim() || undefined,
            ...contactPayload,
            couponCode: appliedCoupon?.code,
            fulfillmentMethod,
          pickupLocationId: selectedPickupLocationId ?? undefined,
            selectedShippingOptionId,
            vendorShippingSelections: perVendorMode
              ? vendorShippingSelections
              : undefined,
            preorderAcknowledged: hasPreorderItems
              ? preorderAccepted
              : undefined,
            preorderMandateAccepted: needsPreorderMandate
              ? preorderMandateAccepted
              : undefined,
          }),
        });
        const intentJson = await intentRes.json().catch(() => null);
        if (!intentRes.ok || !intentJson?.success) {
          if (isCartPricesChangedResponse(intentJson)) {
            throw await pricesChangedError();
          }
          throw new Error(
            intentJson?.message || "Failed to initialize card payment",
          );
        }

        const clientSecret = String(intentJson.data?.clientSecret || "");
        // A pre-order with nothing to pay today comes back as a SetupIntent
        // instead: there is no charge to confirm, only a card to keep.
        const isCardSetup = intentJson.data?.mode === "setup";
        const paymentIntentId = String(intentJson.data?.paymentIntentId || "");
        const setupIntentId = String(intentJson.data?.setupIntentId || "");
        if (!clientSecret || !(isCardSetup ? setupIntentId : paymentIntentId)) {
          throw new Error("Failed to initialize card payment");
        }

        // Read here rather than before the intent call: a remount during
        // that round trip leaves the earlier element destroyed, and Stripe
        // refuses a card it can no longer read. The intent is unconfirmed
        // either way, so nothing is charged.
        const cardNumber = cardNumberElementRef.current;
        if (!cardNumber) {
          throw new Error("Stripe is not ready");
        }

        const cardPaymentMethod = {
          card: cardNumber,
          billing_details: {
            name: cardholderName || billingAddress.fullName,
            email: data.email.trim() || undefined,
            phone: billingAddress.phone,
            address: {
              line1: billingAddress.street,
              line2: billingAddress.apartment || undefined,
              city: billingAddress.city,
              state: billingAddress.state || undefined,
              postal_code: billingAddress.postalCode,
            },
          },
        };

        if (isCardSetup) {
          const setup = await stripe.confirmCardSetup(clientSecret, {
            payment_method: cardPaymentMethod,
          });
          if (setup.error) {
            throw new Error(setup.error.message || "Card could not be saved");
          }
          if (setup.setupIntent?.status !== "succeeded") {
            throw new Error("Card could not be saved");
          }

          // No money moved, so no webhook will build this order — it is placed
          // here, naming the setup so the server can read the card off it. The
          // server verifies that setup against Stripe rather than trusting the
          // id, so a failure here loses nothing but the saved card.
          const placeRes = await fetch("/api/payments/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...checkoutPayload,
              setupIntentId: setup.setupIntent.id,
            }),
          });
          const placeJson = await placeRes.json().catch(() => null);
          if (!placeRes.ok || !placeJson?.success) {
            if (isCartPricesChangedResponse(placeJson)) {
              throw await pricesChangedError();
            }
            throw new Error(
              placeJson?.message || "Failed to place the pre-order",
            );
          }
          toast.success(t("checkout.orderPlaced"));
          goToSuccess(
            placeJson.data?.redirectUrl ||
              `/${locale}/checkout/success?order=${placeJson.data?.orderNumber}`,
          );
          return;
        }

        const confirm = await stripe.confirmCardPayment(clientSecret, {
          payment_method: cardPaymentMethod,
        });

        if (confirm.error) {
          throw new Error(confirm.error.message || "Payment failed");
        }

        const status = confirm.paymentIntent?.status;
        if (status !== "succeeded" && status !== "processing") {
          throw new Error("Payment was not completed");
        }

        goToSuccess(
          `/${locale}/checkout/success?payment_intent=${encodeURIComponent(
            confirm.paymentIntent?.id || paymentIntentId,
          )}`,
        );
        return;
      }

      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...checkoutPayload,
          ...(data.paymentMethod === "iotec"
            ? {
                iotecChannel: data.iotecChannel || "mobile_money",
                iotecPhone: data.iotecPhone,
              }
            : {}),
          ...(data.paymentMethod === "mtn_momo"
            ? { mtnMomoPhone: data.mtnMomoPhone }
            : {}),
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        if (isCartPricesChangedResponse(result)) {
          throw await pricesChangedError();
        }
        throw new Error(result.message || "Failed to process checkout");
      }

      // Saved only once the order is accepted, and deliberately not awaited:
      // this is a convenience write to the account, and a failing address API
      // must never strand a shopper whose payment is already in flight. Placed
      // here rather than in each payment branch because every provider —
      // including the ones that redirect away next — passes through this point.
      if (saveDeliveryAddress && showSaveAddressOption && shippingAddress) {
        void fetch("/api/user/addresses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: {
              firstName: shippingAddress.firstName,
              lastName: shippingAddress.lastName,
              street: shippingAddress.street,
              apartment: shippingAddress.apartment,
              city: shippingAddress.city,
              state: shippingAddress.state,
              postalCode: shippingAddress.postalCode,
              country: shippingAddress.country,
              phone: shippingAddress.phone,
              label: "home",
            },
          }),
        }).catch((saveError) => {
          // Surfaced in the log only. The order succeeded, and an error toast
          // about a side effect would read as the order having failed.
          console.error("Failed to save delivery address:", saveError);
        });
      }

      if (data.paymentMethod === "cod") {
        toast.success(
          t("checkout.orderPlaced"),
        );
        goToSuccess(
          result.data.redirectUrl ||
            `/${locale}/checkout/success?order=${result.data.orderNumber}`,
        );
        return;
      }

      if (data.paymentMethod === "razorpay") {
        const payload = result.data || {};

        // Never resolves: Razorpay takes the page to its callback, which lands
        // the shopper on the success page to verify. Closing Razorpay's window
        // rejects, and the order stays pending for another attempt.
        await openRazorpayCheckout({
          keyId: String(payload.keyId || ""),
          razorpayOrderId: String(payload.razorpayOrderId || ""),
          amount: Number(payload.amount || 0),
          currency: String(payload.currency || currency.code || "INR"),
          name: String(payload.name || "Store"),
          description: String(payload.description || "Order payment"),
          callbackUrl: String(payload.callbackUrl || ""),
          prefill: {
            name: shippingAddress.fullName,
            email: data.email.trim() || undefined,
            contact: shippingAddress.phone,
          },
          notes: {
            orderNumber: String(payload.orderNumber || ""),
          },
          canceledMessage: "Payment was canceled. Please try again.",
        });
        return;
      }

      if (data.paymentMethod === "iotec" && result.data.requiresPolling) {
        // Mobile money: no redirect. The payer approves on their phone; the
        // success page polls /api/payments/iotec/verify until it resolves.
        toast.success("Check your phone to approve the payment");
        const params = new URLSearchParams({
          iotec_transaction_id: String(result.data.iotecTransactionId || ""),
        });
        if (result.data.iotecExternalId) {
          params.set("iotec_external_id", String(result.data.iotecExternalId));
        }
        goToSuccess(`/${locale}/checkout/success?${params.toString()}`);
        return;
      }

      if (data.paymentMethod === "mtn_momo" && result.data.requiresPolling) {
        // Same push shape as ioTec mobile money: the payer approves the PIN
        // prompt on their phone; the success page polls
        // /api/payments/mtn-momo/verify under our reference until it resolves.
        toast.success("Check your phone to approve the payment");
        const params = new URLSearchParams({
          mtn_momo_reference_id: String(result.data.mtnMomoReferenceId || ""),
        });
        goToSuccess(`/${locale}/checkout/success?${params.toString()}`);
        return;
      }

      if (result.data.url) {
        window.location.assign(result.data.url);
      } else {
        throw new Error("Failed to create payment session");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
      toast.error(message || t("common.error"));
    } finally {
      if (!handedOff) setIsSubmitting(false);
    }
  };

  // A selected saved address collapses the delivery fields, and react-hook-form
  // can only focus an invalid field that is rendered — so a saved address the
  // schema rejects left "Complete order" doing nothing at all. Reopen the
  // fields, still filled in, and focus the one that failed.
  const onInvalid = (errors: FieldErrors<CheckoutFormData>) => {
    const field = MANUAL_DELIVERY_ADDRESS_FIELDS.find((name) => errors[name]);
    if (!field || deliveryAddressMode === "manual") return;
    deliveryFieldToFocus.current = field;
    setDeliveryAddressMode("manual");
  };
  useEffect(() => {
    const field = deliveryFieldToFocus.current;
    if (!field || deliveryAddressMode !== "manual") return;
    deliveryFieldToFocus.current = null;
    form.setFocus(field);
  }, [deliveryAddressMode, form]);

  // The cart provider starts with isLoading=true, so this branch runs on every
  // mount — right after the SSR skeleton. Returning the same skeleton keeps the
  // frame identical instead of collapsing the page to a line of centred text
  // and then expanding it back out once the cart resolves.
  if (isLoading) {
    return <CheckoutSkeleton />;
  }

  // Guest checkout off and no account creation here: sign in first. The
  // payment routes refuse the order anyway; this says so before the form.
  if (!authLoading && !isAuthenticated && !guestCheckout && !signupAtCheckout) {
    return (
      <div className="container mx-auto max-w-md px-4 py-16 text-center">
        <Lock className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">
          {tr("checkout.account.loginRequiredTitle", "Log in to check out")}
        </h1>
        <p className="mb-6 text-muted-foreground">
          {tr(
            "checkout.account.loginRequired",
            "This store takes orders from signed-in customers. Log in or create an account to continue.",
          )}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href={buildLoginUrl(locale, `/${locale}/checkout`)}>
              {t("common.login")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/${locale}/register`}>
              {tr("common.register", "Create account")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">
          {t("cart.emptyCart")}
        </h1>
        <p className="text-muted-foreground mb-6">
          {t("checkout.emptyCartMessage")}
        </p>
        <Button asChild>
          <Link href={`/${locale}/products`}>
            {t("common.shopNow")}
          </Link>
        </Button>
      </div>
    );
  }

  // Helper to render a floating label input field.
  // `autoComplete` is passed explicitly rather than derived from `name` because
  // the same helper renders both the delivery and the billing address, and the
  // browser only offers a saved address when the tokens carry the right
  // section — "shipping street-address" and "billing street-address" are two
  // different fields to it, while a bare "street-address" makes it guess.
  const renderFloatingField = (
    name: CheckoutTextFieldName,
    label: string,
    type = "text",
    autoComplete?: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="space-y-0">
          <div className="relative">
            <FormControl>
              <Input
                {...field}
                type={type}
                autoComplete={autoComplete}
                placeholder=" "
                className={floatingInputClass}
                onChange={(event) => {
                  field.onChange(event);
                  if (
                    [
                      "firstName",
                      "lastName",
                      "phone",
                      "address",
                      "apartment",
                      "city",
                      "state",
                      "postalCode",
                    ].includes(name)
                  ) {
                    setSelectedSavedAddressIndex(null);
                  }
                }}
              />
            </FormControl>
            <label className={floatingLabelClass}>{label}</label>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  const optionalSuffix = ` ${tr("checkout.optionalSuffix", "(optional)")}`;
  const addressFieldShown = (key: ConfigurableAddressField) =>
    checkoutSettings.fields[key].visibility !== "hidden";
  const addressFieldLabel = (
    key: ConfigurableAddressField | "country" | "address" | "city",
    fallback: string,
  ) => checkoutSettings.fields[key].label || fallback;
  const customFieldsAt = (placement: CheckoutCustomField["placement"]) =>
    activeCustomFields.filter((field) => field.placement === placement);

  // One of the store's own checkout fields. Text-like answers use the same
  // floating label as the address; the rest need a label that stays put.
  const renderCustomField = (customField: CheckoutCustomField) => {
    const name = `customFields.${customField.id}` as const;
    const label =
      customField.label +
      (customField.visibility === "optional" ? optionalSuffix : "");
    const help = customField.helpText ? (
      <p className="pt-1 text-xs text-muted-foreground">{customField.helpText}</p>
    ) : null;
    const inputType =
      customField.type === "phone"
        ? "tel"
        : customField.type === "number" || customField.type === "email"
          ? customField.type
          : "text";

    return (
      <FormField
        key={customField.id}
        control={form.control}
        name={name}
        render={({ field }) => {
          const textValue = typeof field.value === "string" ? field.value : "";
          if (customField.type === "checkbox") {
            return (
              <FormItem className="space-y-0">
                <div className="flex items-start gap-3 pt-1">
                  <FormControl>
                    <Checkbox
                      id={`checkout-${customField.id}`}
                      checked={field.value === true}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      className="mt-0.5"
                    />
                  </FormControl>
                  <Label
                    htmlFor={`checkout-${customField.id}`}
                    className="cursor-pointer text-sm font-normal leading-5"
                  >
                    {label}
                  </Label>
                </div>
                {help}
                <FormMessage />
              </FormItem>
            );
          }
          if (
            customField.type === "textarea" ||
            customField.type === "select" ||
            customField.type === "date"
          ) {
            return (
              <FormItem className="space-y-1.5">
                <Label htmlFor={`checkout-${customField.id}`}>{label}</Label>
                <FormControl>
                  {customField.type === "textarea" ? (
                    <Textarea
                      id={`checkout-${customField.id}`}
                      value={textValue}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder={customField.placeholder}
                      rows={3}
                    />
                  ) : customField.type === "select" ? (
                    <Select value={textValue} onValueChange={field.onChange}>
                      <SelectTrigger
                        id={`checkout-${customField.id}`}
                        className="h-12 w-full"
                      >
                        <SelectValue
                          placeholder={
                            customField.placeholder ||
                            tr("checkout.selectOption", "Select an option")
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {customField.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`checkout-${customField.id}`}
                      type="date"
                      value={textValue}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      className="h-12"
                    />
                  )}
                </FormControl>
                {help}
                <FormMessage />
              </FormItem>
            );
          }
          return (
            <FormItem className="space-y-0">
              <div className="relative">
                <FormControl>
                  <Input
                    name={field.name}
                    ref={field.ref}
                    value={textValue}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    type={inputType}
                    inputMode={
                      customField.type === "number"
                        ? "decimal"
                        : customField.type === "phone"
                          ? "tel"
                          : undefined
                    }
                    placeholder=" "
                    className={floatingInputClass}
                  />
                </FormControl>
                <label className={floatingLabelClass}>{label}</label>
              </div>
              {help}
              <FormMessage />
            </FormItem>
          );
        }}
      />
    );
  };

  const savedAddressesTitle = t.has("checkout.savedAddresses")
    ? t("checkout.savedAddresses")
    : "Saved addresses";
  const defaultAddressLabel = t.has("checkout.defaultAddress")
    ? t("checkout.defaultAddress")
    : "Default";
  const oneTimeAddressLabel = t.has("checkout.oneTimeAddress")
    ? t("checkout.oneTimeAddress")
    : "Use a new address";
  const shippingUpdatingLabel = t.has("checkout.shippingUpdating")
    ? t("checkout.shippingUpdating")
    : "Updating shipping rates…";
  const shippingRateFailedLabel = t.has("checkout.shippingRateFailed")
    ? t("checkout.shippingRateFailed")
    : "We couldn't update shipping rates. Check the address and try again.";
  const retryShippingRateLabel = t.has("common.retry")
    ? t("common.retry")
    : "Retry";
  const switchToPickupLabel = t.has("checkout.switchToPickup")
    ? t("checkout.switchToPickup")
    : "Switch to local pickup";
  // Recovery action for the shipping-unavailable alert: the fix lives in the
  // address section, which on a phone has long since scrolled off screen by
  // the time the shopper reads the alert.
  const scrollToDeliveryAddress = () => {
    document
      .getElementById("checkout-delivery-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const showManualDeliveryAddressForm = shouldShowManualDeliveryAddressForm({
    isAuthenticated,
    savedAddressesLoaded,
    savedAddressCount: savedAddresses.length,
    addressMode: deliveryAddressMode,
  });
  // Offered against what the shopper has actually typed so far, so the checkbox
  // appears once the address is complete and disappears again if they edit it
  // back into one they already have saved.
  const showSaveAddressOption =
    !isDigitalOnly &&
    fulfillmentMethod === "delivery" &&
    showManualDeliveryAddressForm &&
    canOfferToSaveAddress({
      isAuthenticated,
      address: {
        firstName: watchedFirstName,
        lastName: watchedLastName,
        street: watchedAddress,
        apartment: watchedApartment,
        city: watchedCity,
        state: watchedState,
        postalCode: watchedPostalCode,
        country: watchedCountry,
        phone: watchedPhone,
      },
      savedAddresses,
    });
  // Collection is a *fulfillment* choice, not a payment one. It was gated on COD
  // because pickup was imagined as cash-at-the-counter, but that reasoning is
  // backwards: a prepaid collection is the safer of the two — the money is
  // already in before anyone walks out with the goods — and gating on COD hid
  // the entire feature from every prepaid-only merchant.
  const pickupAvailable = pickupAvailability.eligible;
  const multiVendorPickup = pickupAvailability.reason === "multi_vendor";
  const showFulfillmentSelector = shouldShowFulfillmentSelector({
    pickupAvailable,
    multiVendor: multiVendorPickup,
  });
  // Digital-only checkouts have no shipping address for billing to be "same
  // as" — the billing form is always shown and required.
  const effectiveBillingMode = isDigitalOnly ? "different" : billingAddressMode;

  return (
    <div className="min-h-screen bg-background">
      <Form {...form}>
        <form
          onSubmit={(event) =>
            void form.handleSubmit(onSubmit, onInvalid)(event)
          }
        >
          <div className="mx-auto  lg:grid lg:grid-cols-2">
            {/* Left column - Form */}
            <div className="px-4 py-8 lg:px-10 lg:py-12 lg:pr-16">
              <div className="max-w-[480px] mx-auto lg:mx-0 lg:ml-auto">
                {error ? (
                  <Alert variant="destructive" className="mb-6">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-8">
                  {/* Contact Section — what it asks for is the checkout
                      settings' contact mode; see evaluateCheckoutSubmission. */}
                  <section className="space-y-4 border-b pb-6">
                    {!isAuthenticated && (
                      <div className="space-y-1">
                        <h2 className="text-xl font-semibold tracking-tight">
                          {guestCheckout
                            ? tr("checkout.guestTitle", "Checkout as Guest")
                            : tr(
                                "checkout.account.createToCheckout",
                                "Create an account to check out",
                              )}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                          {t("common.or")}{" "}
                          <Link
                            href={buildLoginUrl(locale, `/${locale}/checkout`)}
                            className="font-medium text-foreground underline underline-offset-4"
                          >
                            {tr("checkout.logIn", "Log in")}
                          </Link>{" "}
                          {tr("checkout.forFasterCheckout", "for faster checkout")}
                        </p>
                      </div>
                    )}

                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">
                        {tr("checkout.contactDetails", "Contact details")}
                      </h3>
                      {isAuthenticated && contactLabel ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            {user?.image ? (
                              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full">
                                <AppImage
                                  src={user.image}
                                  alt={user.name || ""}
                                  fill
                                  className="object-cover"
                                />
                              </div>
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                                {contactInitial}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm text-muted-foreground">
                                {contactLabel}
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto px-0 text-base underline underline-offset-4"
                            onClick={async () => {
                              await signOut();
                              window.location.reload();
                            }}
                          >
                            {t("common.logout")}
                          </Button>
                        </div>
                      ) : collects.email ? (
                        renderFloatingField(
                          "email",
                          (checkoutSettings.contact.emailLabel ||
                            tr("checkout.email", "Email")) +
                            (checkoutSettings.contact.mode === "email_or_phone" &&
                            !(watchedCreateAccount || accountRequired)
                              ? optionalSuffix
                              : ""),
                          "email",
                          "email",
                        )
                      ) : null}
                      {collects.phone
                        ? renderFloatingField(
                            "contactPhone",
                            (checkoutSettings.contact.phoneLabel ||
                              t("checkout.phone")) +
                              (checkoutSettings.contact.mode === "email_or_phone"
                                ? optionalSuffix
                                : ""),
                            "tel",
                            "tel",
                          )
                        : null}
                      {checkoutSettings.contact.mode === "email_or_phone" &&
                      !isAuthenticated ? (
                        <p className="text-xs text-muted-foreground">
                          {tr(
                            "checkout.emailOrPhoneHint",
                            "Enter an email or a phone number — we'll send order updates there.",
                          )}
                        </p>
                      ) : null}
                      {checkoutSettings.contact.marketingOptIn.enabled ? (
                        <div className="flex items-center gap-2 pt-1">
                          <Checkbox
                            id="checkout-newsletter"
                            checked={emailMarketingOptIn}
                            onCheckedChange={(checked) =>
                              setEmailMarketingOptIn(checked === true)
                            }
                          />
                          <Label
                            htmlFor="checkout-newsletter"
                            className="cursor-pointer text-sm font-normal"
                          >
                            {checkoutSettings.contact.marketingOptIn.label ||
                              tr(
                                "checkout.marketingOptIn",
                                "Email me with news and offers",
                              )}
                          </Label>
                        </div>
                      ) : null}

                      {/* Account creation at checkout. Optional as a tick-box
                          while guests may order; the only way in when not. */}
                      {!isAuthenticated && signupAtCheckout ? (
                        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                          {accountRequired ? (
                            <p className="text-sm font-medium">
                              {tr(
                                "checkout.account.requiredHint",
                                "Choose a password for your new account.",
                              )}
                            </p>
                          ) : (
                            <FormField
                              control={form.control}
                              name="createAccount"
                              render={({ field }) => (
                                <FormItem className="space-y-0">
                                  <div className="flex items-start gap-3">
                                    <FormControl>
                                      <Checkbox
                                        id="checkout-create-account"
                                        checked={field.value}
                                        onCheckedChange={(checked) =>
                                          field.onChange(checked === true)
                                        }
                                        className="mt-0.5"
                                      />
                                    </FormControl>
                                    <Label
                                      htmlFor="checkout-create-account"
                                      className="cursor-pointer text-sm font-normal leading-5"
                                    >
                                      {tr(
                                        "checkout.account.create",
                                        "Create an account for faster checkout next time",
                                      )}
                                    </Label>
                                  </div>
                                </FormItem>
                              )}
                            />
                          )}
                          {accountRequired || watchedCreateAccount
                            ? renderFloatingField(
                                "accountPassword",
                                tr("checkout.account.password", "Password"),
                                "password",
                                "new-password",
                              )
                            : null}
                        </div>
                      ) : null}

                      {customFieldsAt("contact").map(renderCustomField)}
                    </div>
                  </section>

                  {showFulfillmentSelector ? <PickupFulfillmentSelector
                    method={fulfillmentMethod}
                    pickupAvailable={pickupAvailable}
                    multiVendor={multiVendorPickup}
                    locations={pickupAvailability.locations}
                    selectedLocationId={selectedPickupLocationId}
                    loading={pickupAvailability.loading}
                    onMethodChange={changeFulfillmentMethod}
                    onLocationChange={changePickupLocation}
                    distanceLabel={(km) => t("location.kmAway", { km })}
                    labels={{
                      fulfillment: t("checkout.fulfillment"),
                      delivery: t("checkout.delivery"),
                      deliveryHint: t("checkout.pickup.deliveryHint"),
                      pickup: t("checkout.pickup.localPickup"),
                      pickupHint: t("checkout.pickup.pickupHint"),
                      multiVendor: t("checkout.pickup.deliveryOnly"),
                      chooseLocation: t("checkout.pickup.chooseLocation"),
                      branchOutOfStock: t.has("checkout.pickup.branchOutOfStock")
                        ? t("checkout.pickup.branchOutOfStock")
                        : "Doesn't have everything in your order",
                      noBranchHasEverything: t.has(
                        "checkout.pickup.noBranchHasEverything",
                      )
                        ? t("checkout.pickup.noBranchHasEverything")
                        : "No collection point has every item in your order right now. Choose delivery, or remove an item to collect the rest.",
                      collectDuringOpeningHours: t(
                        "checkout.pickup.collectDuringOpeningHours",
                      ),
                      contactStoreForHours: t(
                        "checkout.pickup.contactStoreForHours",
                      ),
                    }}
                  /> : null}

                  {/* Delivery Section — hidden for digital-only carts, which
                      need no shipping address (billing is collected below).
                      The id is the scroll target for the "Change address"
                      recovery action in the shipping-unavailable alert. */}
                  {!isDigitalOnly && (
                  <section
                    id="checkout-delivery-section"
                    className="scroll-mt-24 space-y-3"
                  >
                    <h2 className="text-lg font-semibold">
                      {fulfillmentMethod === "pickup"
                        ? t("checkout.contactBilling")
                        : t("checkout.delivery")}
                    </h2>

                    {isAuthenticated && savedAddressesLoaded && savedAddresses.length > 0 ? (
                      deliveryAddressMode === "saved" ? (
                      <SavedAddressSelector
                        addresses={savedAddresses}
                        selectedIndex={selectedSavedAddressIndex}
                        onSelect={applySavedAddress}
                        onChangeAddress={chooseSavedAddress}
                        onUseOneTimeAddress={useOneTimeAddress}
                        title={savedAddressesTitle}
                        defaultLabel={defaultAddressLabel}
                        changeAddressLabel={t("checkout.changeAddress")}
                        oneTimeAddressLabel={oneTimeAddressLabel}
                      />
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={chooseSavedAddress}
                        >
                          {t("checkout.useSavedAddress")}
                        </Button>
                      )
                    ) : null}

                    {showManualDeliveryAddressForm ? <div className="space-y-3">
                      {/* Country Select */}
                      <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem className="w-full space-y-0">
                            <div className="relative w-full">
                              <CountrySelect
                                value={field.value || ""}
                                onChange={(value) => {
                                  field.onChange(value);
                                  setSelectedSavedAddressIndex(null);
                                  // A region only means anything within the
                                  // country it belongs to. Carrying "Dhaka"
                                  // over into India would leave the rate
                                  // engine matching a zone the shopper is not
                                  // in, so drop a value the new country has no
                                  // place for. Countries without a region list
                                  // keep whatever was typed — there is nothing
                                  // to validate it against.
                                  const nextRegions = regionsForCountry(value);
                                  const currentState = form.getValues("state");
                                  if (
                                    currentState &&
                                    nextRegions.length > 0 &&
                                    !nextRegions.some(
                                      (region) =>
                                        region.label.trim().toLowerCase() ===
                                        currentState.trim().toLowerCase(),
                                    )
                                  ) {
                                    form.setValue("state", "", {
                                      shouldValidate: true,
                                    });
                                  }
                                }}
                                placeholder=" "
                                searchPlaceholder={t("checkout.searchCountry")}
                                triggerClassName="h-14 rounded-lg pt-6 pb-2 items-end [&>span]:text-base"
                              />
                              <span className="pointer-events-none absolute left-3 top-2 text-xs text-muted-foreground z-10">
                                {addressFieldLabel("country", t("checkout.country"))}
                              </span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Name, apartment, postcode, state and phone are each
                          required, optional or hidden per the checkout
                          settings; a lone name part takes the full row. */}
                      {addressFieldShown("firstName") || addressFieldShown("lastName") ? (
                        <div
                          className={cn(
                            "grid gap-3",
                            addressFieldShown("firstName") &&
                              addressFieldShown("lastName") &&
                              "grid-cols-2",
                          )}
                        >
                          {addressFieldShown("firstName")
                            ? renderFloatingField(
                                "firstName",
                                addressFieldLabel("firstName", t("checkout.firstName")),
                                "text",
                                "shipping given-name",
                              )
                            : null}
                          {addressFieldShown("lastName")
                            ? renderFloatingField(
                                "lastName",
                                addressFieldLabel("lastName", t("checkout.lastName")),
                                "text",
                                "shipping family-name",
                              )
                            : null}
                        </div>
                      ) : null}

                      {/* Address */}
                      {renderFloatingField(
                        "address",
                        addressFieldLabel("address", t("checkout.address")),
                        "text",
                        "shipping address-line1",
                      )}

                      {/* Apartment */}
                      {addressFieldShown("apartment")
                        ? renderFloatingField(
                            "apartment",
                            addressFieldLabel("apartment", t("checkout.apartment")),
                            "text",
                            "shipping address-line2",
                          )
                        : null}

                      {/* City + Postal code */}
                      <div
                        className={cn(
                          "grid gap-3",
                          addressFieldShown("postalCode") && "grid-cols-2",
                        )}
                      >
                        {renderFloatingField(
                          "city",
                          addressFieldLabel("city", t("checkout.city")),
                          "text",
                          "shipping address-level2",
                        )}
                        {addressFieldShown("postalCode")
                          ? renderFloatingField(
                              "postalCode",
                              addressFieldLabel("postalCode", t("checkout.postalCode")),
                              "text",
                              "shipping postal-code",
                            )
                          : null}
                      </div>

                      {/* State — not decoration. Shipping zones match their
                          `regions` against this, so an address without one is
                          rated against a country-wide zone or the fallback and
                          the shopper is quoted a charge they do not owe. A
                          saved address already carries it; this is the only
                          way a one-time or guest address can.

                          A picker rather than free text for the same reason:
                          the zone match is a string comparison, so "Dhaka",
                          "dhaka" and "Dahka" are three different destinations
                          to the rate engine and only one of them is priced
                          correctly. Countries we have no region list for still
                          get a text input. */}
                      {addressFieldShown("state") ? (
                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem className="space-y-0">
                            <FormControl>
                              <RegionSelect
                                id="checkout-state"
                                country={watchedCountry}
                                value={field.value || ""}
                                onChange={(value) => {
                                  field.onChange(value);
                                  setSelectedSavedAddressIndex(null);
                                }}
                                label={addressFieldLabel("state", t("checkout.state"))}
                                autoComplete="shipping address-level1"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      ) : null}

                      {/* Delivery phone — the contact phone stands in when
                          this is hidden or left blank. */}
                      {addressFieldShown("phone")
                        ? renderFloatingField(
                            "phone",
                            addressFieldLabel("phone", t("checkout.phone")),
                            "tel",
                            "shipping tel",
                          )
                        : null}


                      {/* Appears only once the address is complete and is not
                          one the account already has, so it never offers to
                          save a duplicate or a half-typed address. */}
                      {showSaveAddressOption ? (
                        <div className="flex items-start gap-3 pt-1">
                          <Checkbox
                            id="checkout-save-address"
                            checked={saveDeliveryAddress}
                            onCheckedChange={(checked) =>
                              setSaveDeliveryAddress(checked === true)
                            }
                            className="mt-0.5"
                          />
                          <Label
                            htmlFor="checkout-save-address"
                            className="cursor-pointer text-sm font-normal leading-5 text-muted-foreground"
                          >
                            {t.has("checkout.saveAddress")
                              ? t("checkout.saveAddress")
                              : "Save this address to my account"}
                          </Label>
                        </div>
                      ) : null}
                    </div> : null}

                    {customFieldsAt("delivery").length > 0 ? (
                      <div className="space-y-3">
                        {customFieldsAt("delivery").map(renderCustomField)}
                      </div>
                    ) : null}
                  </section>
                  )}

                  {!isDigitalOnly && <Separator />}

                  {/* Shipping Method — meaningless for digital-only carts,
                      and for pickup there is nothing to ship. */}
                  {fulfillmentMethod === "delivery" && !isDigitalOnly ? (
                    <section className="space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-lg font-semibold">
                        {t("checkout.shippingMethod")}
                      </h2>
                      {/* Re-quote in progress with the previous rates still on
                          screen: announced up here beside the heading so the
                          list below keeps its height instead of swapping for a
                          spinner row. */}
                      {shippingQuotePending && serverShippingResolution ? (
                        <span
                          role="status"
                          aria-live="polite"
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          {shippingUpdatingLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      {!shippingRatesWanted ? (
                        // No address yet, so nothing has been quoted — and
                        // nothing refused either.
                        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                          {t("checkout.enterAddressForShipping")}
                        </p>
                      ) : shippingRateFailed ? (
                        <div
                          role="alert"
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
                        >
                          <span>{shippingRateFailedLabel}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShippingRateRetry((value) => value + 1)}
                          >
                            {retryShippingRateLabel}
                          </Button>
                        </div>
                      ) : shippingQuotePending && !serverShippingResolution ? (
                        // Nothing to keep on screen yet — first quote for this
                        // destination. Re-quotes keep the old cards and dim
                        // them below instead.
                        <div
                          role="status"
                          aria-live="polite"
                          className="flex items-center gap-2 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          {shippingUpdatingLabel}
                        </div>
                      ) : (
                      <div
                        aria-busy={shippingQuotePending}
                        className={cn(
                          "space-y-2",
                          shippingQuotePending &&
                            "pointer-events-none opacity-60",
                        )}
                      >
                      {shippingUnavailable ? (
                        <div
                          role="alert"
                          className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
                        >
                          <p>
                            {t("checkout.shippingUnavailable", {
                              defaultMessage: SHIPPING_UNAVAILABLE_MESSAGE,
                            })}
                          </p>
                          {/* A dead end otherwise: the shopper is told delivery
                              is impossible and left staring at a disabled
                              submit button. Offer the two moves that actually
                              resolve it. */}
                          <div className="flex flex-wrap gap-2">
                            {pickupAvailable ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  changeFulfillmentMethod("pickup")
                                }
                              >
                                {switchToPickupLabel}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={scrollToDeliveryAddress}
                            >
                              {t("checkout.changeAddress")}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {perVendorMode ? (
                        vendorRateGroups.map((group) => {
                          const selectedId =
                            vendorShippingSelections[group.vendorId] ??
                            group.selectedOptionId;
                          return (
                            <div key={group.vendorId} className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">
                                {group.vendorName}
                              </p>
                              {group.options.length === 0 ? (
                                // This vendor is the reason the whole quote is
                                // unavailable (the server ANDs availability
                                // across vendors), so it must read as the
                                // problem, not as a hint the eye skips over.
                                <div
                                  role="alert"
                                  className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                                >
                                  <AlertCircle
                                    className="mt-0.5 h-4 w-4 shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span>{t("checkout.noShippingRates")}</span>
                                </div>
                              ) : (
                                group.options.map((option) => {
                                  const checked = selectedId === option.id;
                                  return (
                                    <label
                                      key={option.id}
                                      className={cn(
                                        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 text-sm transition-colors hover:bg-muted/40",
                                        checked
                                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                                          : "border-border",
                                      )}
                                    >
                                      <span className="flex items-center gap-3">
                                        <input
                                          type="radio"
                                          name={`shippingOption-${group.vendorId}`}
                                          className="accent-primary"
                                          checked={checked}
                                          onChange={() =>
                                            setVendorShippingSelections(
                                              (prev) => ({
                                                ...prev,
                                                [group.vendorId]: option.id,
                                              }),
                                            )
                                          }
                                        />
                                        <span>
                                          <span className="font-medium">
                                            {option.name}
                                          </span>
                                          {option.deliveryDays ? (
                                            <span className="block text-xs text-muted-foreground">
                                              {option.deliveryDays.min}-
                                              {option.deliveryDays.max}{" "}
                                              {t("checkout.days")}
                                            </span>
                                          ) : null}
                                        </span>
                                      </span>
                                      <span className="font-semibold">
                                        {option.cost > 0
                                          ? formatPrice(option.cost)
                                          : t("checkout.free")}
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          );
                        })
                      ) : shippingUnavailable ? (
                        // Single-shipment mode with no destination coverage:
                        // the alert above already says it, and the collapsed
                        // "selected method" row below would dress a
                        // nonexistent rate up as a choice.
                        null
                      ) : shippingOptions.length > 1 ? (
                        shippingOptions.map((option) => {
                          const checked =
                            (selectedShippingOptionId ??
                              shippingResult.selectedOptionId) === option.id;
                          return (
                            <label
                              key={option.id}
                              className={cn(
                                "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 text-sm transition-colors hover:bg-muted/40",
                                checked
                                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                                  : "border-border",
                              )}
                            >
                              <span className="flex items-center gap-3">
                                <input
                                  type="radio"
                                  name="shippingOption"
                                  className="accent-primary"
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedShippingOptionId(option.id)
                                  }
                                />
                                <span>
                                  <span className="font-medium">
                                    {option.name}
                                  </span>
                                  {option.deliveryDays ? (
                                    <span className="block text-xs text-muted-foreground">
                                      {option.deliveryDays.min}-
                                      {option.deliveryDays.max}{" "}
                                      {t("checkout.days")}
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                              <span className="font-semibold">
                                {option.cost > 0
                                  ? formatPrice(option.cost)
                                  : t("checkout.free")}
                              </span>
                            </label>
                          );
                        })
                      ) : (
                        <div className="flex items-center justify-between rounded-lg border border-primary bg-primary/5 p-4">
                          <div className="flex items-center gap-3">
                            <div className="h-4 w-4 rounded-full border-4 border-primary bg-primary" />
                            <span className="text-sm text-muted-foreground">
                              {shippingMethodName ||
                                t("checkout.standardShipping")}
                            </span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {shippingDiscount > 0 ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="line-through">
                                  {formatPrice(shippingCost)}
                                </span>
                                <span>
                                  {discountedShippingCost === 0
                                    ? t("common.free")
                                    : formatPrice(discountedShippingCost)}
                                </span>
                              </span>
                            ) : discountedShippingCost === 0 ? (
                              t("common.free")
                            ) : (
                              formatPrice(discountedShippingCost)
                            )}
                          </span>
                        </div>
                      )}
                      </div>
                      )}
                    </div>
                    </section>
                  ) : null}

                  {/* Additional information — the order note and the store's
                      own questions placed after delivery. */}
                  {checkoutSettings.orderNote.visibility !== "hidden" ||
                  customFieldsAt("additional").length > 0 ? (
                    <section className="space-y-3">
                      <h2 className="text-lg font-semibold">
                        {tr("checkout.additionalInformation", "Additional information")}
                      </h2>
                      {customFieldsAt("additional").map(renderCustomField)}
                      {checkoutSettings.orderNote.visibility !== "hidden" ? (
                        <FormField
                          control={form.control}
                          name="customerNote"
                          render={({ field }) => (
                            <FormItem className="space-y-1.5">
                              <Label htmlFor="checkout-customer-note">
                                {(checkoutSettings.orderNote.label ||
                                  tr("checkout.orderNote", "Order note")) +
                                  (checkoutSettings.orderNote.visibility === "optional"
                                    ? optionalSuffix
                                    : "")}
                              </Label>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  id="checkout-customer-note"
                                  rows={3}
                                  maxLength={CHECKOUT_NOTE_MAX}
                                  placeholder={
                                    checkoutSettings.orderNote.placeholder ||
                                    tr(
                                      "checkout.orderNotePlaceholder",
                                      "Special instructions for your order",
                                    )
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : null}
                    </section>
                  ) : null}

                  {/* Payment */}
                  <section className="space-y-4">
                    <div className="space-y-2">
                      <h2 className="text-lg font-semibold">
                        {t("checkout.paymentMethod")}
                      </h2>
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        {checkoutSettings.trust.showSecureBadge ? (
                          <Lock className="h-3.5 w-3.5 shrink-0" />
                        ) : null}
                        {checkoutSettings.trust.message.trim() ||
                          t("checkout.payment.secure")}
                      </p>
                    </div>

                    {noPaymentMethodAvailable ? (
                      <div className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                        No payment method is available for this order. Please
                        contact support.
                      </div>
                    ) : (
                    <FormField
                      control={form.control}
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <RadioGroup
                              value={field.value}
                              onValueChange={field.onChange}
                              className="gap-0 overflow-hidden rounded-lg border bg-background"
                            >
                              {paymentMethods.map((method, index) => {
                                const isSelected = field.value === method.value;
                                const isCard =
                                  method.value === "card" &&
                                  paymentConfig.stripeEnabled &&
                                  paymentConfig.stripeConfigured !== false &&
                                  paymentConfig.stripePublishableKey;

                                return (
                                  <div
                                    key={method.value}
                                    className={cn(
                                      index > 0 && "border-t",
                                      isSelected && "bg-background",
                                    )}
                                  >
                                    <Label
                                      htmlFor={`pm_${method.value}`}
                                      className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/40"
                                    >
                                      <RadioGroupItem
                                        value={method.value}
                                        id={`pm_${method.value}`}
                                        className="size-4 shrink-0 border-muted-foreground/30"
                                      />
                                      <span className="min-w-0 flex-1">
                                        {method.label}
                                      </span>
                                      <method.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </Label>

                                    {/* A gateway that cannot open without an
                                        email, on a checkout that did not ask
                                        for one. */}
                                    {isSelected &&
                                    !isAuthenticated &&
                                    !collects.email &&
                                    paymentMethodNeedsEmail(
                                      method.value,
                                      selectedIotecChannel,
                                    ) ? (
                                      <div className="space-y-2 border-t bg-muted/20 px-4 pt-4">
                                        <p className="text-xs text-muted-foreground">
                                          {tr(
                                            "checkout.payment.emailRequired",
                                            "This payment method sends your receipt by email.",
                                          )}
                                        </p>
                                        {renderFloatingField(
                                          "email",
                                          checkoutSettings.contact.emailLabel ||
                                            tr("checkout.email", "Email"),
                                          "email",
                                          "email",
                                        )}
                                      </div>
                                    ) : null}
                                    {isSelected ? (
                                      isCard ? (
                                        <div className="space-y-3 border-t bg-muted/20 px-4 py-4">
                                          <h3 className="text-base font-semibold">
                                            {t("checkout.cardDetails")}
                                          </h3>
                                          <div
                                            className="relative cursor-text"
                                            onClick={() =>
                                              cardNumberElementRef.current?.focus()
                                            }
                                          >
                                            <div
                                              ref={setCardNumberMountEl}
                                              className="dark:bg-input/30 border-input min-h-11 rounded-md border bg-background px-4 py-3 pr-4 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] sm:pr-36"
                                            />
                                            <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 sm:flex">
                                              <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-[3px] border bg-white px-1 text-[9px] font-bold leading-none text-blue-700 shadow-xs">
                                                VISA
                                              </span>
                                              <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-[3px] border bg-white px-1 shadow-xs">
                                                <span className="h-3 w-3 rounded-full bg-red-500" />
                                                <span className="-ml-1 h-3 w-3 rounded-full bg-amber-400" />
                                              </span>
                                              <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-[3px] border bg-white px-1 text-[8px] font-bold leading-none text-cyan-700 shadow-xs">
                                                AMEX
                                              </span>
                                              <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-[3px] border bg-white px-1 text-[8px] font-bold leading-none text-orange-700 shadow-xs">
                                                DISC
                                              </span>
                                            </div>
                                          </div>

                                          <div className="grid gap-2 sm:grid-cols-2">
                                            <div
                                              className="relative cursor-text"
                                              onClick={() =>
                                                cardExpiryElementRef.current?.focus()
                                              }
                                            >
                                              <div
                                                ref={setCardExpiryMountEl}
                                                className="dark:bg-input/30 border-input min-h-11 rounded-md border bg-background px-4 py-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
                                              />
                                            </div>

                                            <div
                                              className="relative cursor-text"
                                              onClick={() =>
                                                cardCvcElementRef.current?.focus()
                                              }
                                            >
                                              <div
                                                ref={setCardCvcMountEl}
                                                className="dark:bg-input/30 border-input min-h-11 rounded-md border bg-background px-4 py-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
                                              />
                                              <CreditCard className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                                            </div>
                                          </div>

                                          <Input
                                            value={cardholderName}
                                            onChange={(e) =>
                                              setCardholderName(e.target.value)
                                            }
                                            placeholder={t(
                                              "payment.cardHolder",
                                            )}
                                            className="h-11 rounded-md px-4 text-[15px]"
                                          />

                                          {stripeElementError ? (
                                            <div className="text-sm text-destructive">
                                              {stripeElementError}
                                            </div>
                                          ) : null}
                                          {!stripeElementReady ? (
                                            <div className="text-sm text-muted-foreground">
                                              {t("common.loading")}
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : method.value === "iotec" ? (
                                        <div className="space-y-3 border-t bg-muted/20 px-4 py-4">
                                          <p className="text-sm text-muted-foreground">
                                            {method.detail}
                                          </p>
                                          <FormField
                                            control={form.control}
                                            name="iotecChannel"
                                            render={({
                                              field: channelField,
                                            }) => (
                                              <FormItem className="space-y-1">
                                                <Label>
                                                  {t(
                                                    "checkout.payment.iotecChannel",
                                                  )}
                                                </Label>
                                                <div className="grid grid-cols-2 gap-2">
                                                  {IOTEC_CHANNELS.map(
                                                    (channel) => {
                                                      const isActive =
                                                        (channelField.value ||
                                                          "mobile_money") ===
                                                        channel.value;
                                                      return (
                                                        <button
                                                          key={channel.value}
                                                          type="button"
                                                          aria-pressed={isActive}
                                                          onClick={() =>
                                                            channelField.onChange(
                                                              channel.value,
                                                            )
                                                          }
                                                          className={cn(
                                                            "flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
                                                            isActive
                                                              ? "border-primary bg-primary/10 text-primary"
                                                              : "bg-background text-muted-foreground hover:bg-muted",
                                                          )}
                                                        >
                                                          <channel.icon className="h-4 w-4" />
                                                          {t(channel.labelKey)}
                                                        </button>
                                                      );
                                                    },
                                                  )}
                                                </div>
                                              </FormItem>
                                            )}
                                          />
                                          {selectedIotecChannel === "card" ? (
                                            <p className="text-xs text-muted-foreground">
                                              {t(
                                                "checkout.payment.iotecCardHint",
                                              )}
                                            </p>
                                          ) : (
                                            <FormField
                                              control={form.control}
                                              name="iotecPhone"
                                              render={({
                                                field: phoneField,
                                              }) => (
                                                <FormItem className="space-y-1">
                                                  <Label htmlFor="iotecPhone">
                                                    {t(
                                                      "checkout.payment.iotecPhoneLabel",
                                                    )}
                                                  </Label>
                                                  <FormControl>
                                                    <Input
                                                      {...phoneField}
                                                      id="iotecPhone"
                                                      type="tel"
                                                      inputMode="tel"
                                                      autoComplete="tel"
                                                      placeholder={t(
                                                        "checkout.payment.iotecPhonePlaceholder",
                                                      )}
                                                      className="h-11 rounded-md px-4 text-[15px]"
                                                    />
                                                  </FormControl>
                                                  <p className="text-xs text-muted-foreground">
                                                    {t(
                                                      "checkout.payment.iotecPhoneHint",
                                                    )}
                                                  </p>
                                                  <FormMessage />
                                                </FormItem>
                                              )}
                                            />
                                          )}
                                        </div>
                                      ) : method.value === "mtn_momo" ? (
                                        <div className="space-y-3 border-t bg-muted/20 px-4 py-4">
                                          <p className="text-sm text-muted-foreground">
                                            {method.detail}
                                          </p>
                                          <FormField
                                            control={form.control}
                                            name="mtnMomoPhone"
                                            render={({
                                              field: phoneField,
                                            }) => (
                                              <FormItem className="space-y-1">
                                                <Label htmlFor="mtnMomoPhone">
                                                  {t(
                                                    "checkout.payment.mtnMomoPhoneLabel",
                                                  )}
                                                </Label>
                                                <FormControl>
                                                  <Input
                                                    {...phoneField}
                                                    id="mtnMomoPhone"
                                                    type="tel"
                                                    inputMode="tel"
                                                    autoComplete="tel"
                                                    placeholder={t(
                                                      "checkout.payment.mtnMomoPhonePlaceholder",
                                                      { example: mtnMomoPhoneExample },
                                                    )}
                                                    className="h-11 rounded-md px-4 text-[15px]"
                                                  />
                                                </FormControl>
                                                <p className="text-xs text-muted-foreground">
                                                  {t(
                                                    "checkout.payment.mtnMomoPhoneHint",
                                                  )}
                                                </p>
                                                <FormMessage />
                                              </FormItem>
                                            )}
                                          />
                                        </div>
                                      ) : (
                                        <div className="border-t bg-muted/20 px-4 py-4 text-center text-sm text-muted-foreground">
                                          {method.detail}
                                        </div>
                                      )
                                    ) : null}
                                  </div>
                                );
                              })}
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    )}
                  </section>

                  {/* Billing Address */}
                  <section className="space-y-3">
                    <h2 className="text-lg font-semibold">
                      {t("checkout.billingAddress")}
                    </h2>
                    <FormField
                      control={form.control}
                      name="billingSameAsShipping"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <RadioGroup
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <div className="rounded-lg border overflow-hidden">
                                {!isDigitalOnly && (
                                <>
                                <div
                                  className={cn(
                                    "flex items-center gap-3 p-4 transition-colors",
                                    field.value === "same" && "bg-accent",
                                  )}
                                >
                                  <RadioGroupItem value="same" id="bill_same" />
                                  <Label
                                    htmlFor="bill_same"
                                    className="cursor-pointer font-normal"
                                  >
                                    {t("checkout.billingSame")}
                                  </Label>
                                </div>
                                <div className="border-t" />
                                <div
                                  className={cn(
                                    "flex items-center gap-3 p-4 transition-colors",
                                    field.value === "different" && "bg-accent",
                                  )}
                                >
                                  <RadioGroupItem
                                    value="different"
                                    id="bill_diff"
                                  />
                                  <Label
                                    htmlFor="bill_diff"
                                    className="cursor-pointer font-normal"
                                  >
                                    {t("checkout.billingDifferent")}
                                  </Label>
                                </div>
                                </>
                                )}
                                {effectiveBillingMode === "different" ? (
                                  <div
                                    className={cn(
                                      "space-y-3 bg-background p-4",
                                      !isDigitalOnly && "border-t",
                                    )}
                                  >
                                    <FormField
                                      control={form.control}
                                      name="billingCountry"
                                      render={({ field }) => (
                                        <FormItem className="w-full space-y-0">
                                          <div className="relative w-full">
                                            <CountrySelect
                                              value={field.value || ""}
                                              onChange={field.onChange}
                                              placeholder=" "
                                              searchPlaceholder={t(
                                                "checkout.searchCountry",
                                              )}
                                              triggerClassName="h-14 rounded-lg pt-6 pb-2 items-end [&>span]:text-base"
                                            />
                                            <span className="pointer-events-none absolute left-3 top-2 z-10 text-xs text-muted-foreground">
                                              {addressFieldLabel("country", t("checkout.country"))}
                                            </span>
                                          </div>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />

                                    {addressFieldShown("firstName") ||
                                    addressFieldShown("lastName") ? (
                                      <div
                                        className={cn(
                                          "grid gap-3",
                                          addressFieldShown("firstName") &&
                                            addressFieldShown("lastName") &&
                                            "grid-cols-2",
                                        )}
                                      >
                                        {addressFieldShown("firstName")
                                          ? renderFloatingField(
                                              "billingFirstName",
                                              addressFieldLabel("firstName", t("checkout.firstName")),
                                              "text",
                                              "billing given-name",
                                            )
                                          : null}
                                        {addressFieldShown("lastName")
                                          ? renderFloatingField(
                                              "billingLastName",
                                              addressFieldLabel("lastName", t("checkout.lastName")),
                                              "text",
                                              "billing family-name",
                                            )
                                          : null}
                                      </div>
                                    ) : null}

                                    {renderFloatingField(
                                      "billingAddress",
                                      addressFieldLabel("address", t("checkout.address")),
                                      "text",
                                      "billing address-line1",
                                    )}
                                    {addressFieldShown("apartment")
                                      ? renderFloatingField(
                                          "billingApartment",
                                          addressFieldLabel("apartment", t("checkout.apartment")),
                                          "text",
                                          "billing address-line2",
                                        )
                                      : null}

                                    <div
                                      className={cn(
                                        "grid gap-3",
                                        addressFieldShown("postalCode") && "grid-cols-2",
                                      )}
                                    >
                                      {renderFloatingField(
                                        "billingCity",
                                        addressFieldLabel("city", t("checkout.city")),
                                        "text",
                                        "billing address-level2",
                                      )}
                                      {addressFieldShown("postalCode")
                                        ? renderFloatingField(
                                            "billingPostalCode",
                                            addressFieldLabel("postalCode", t("checkout.postalCode")),
                                            "text",
                                            "billing postal-code",
                                          )
                                        : null}
                                    </div>

                                    {addressFieldShown("state") ? (
                                      <FormField
                                        control={form.control}
                                        name="billingState"
                                        render={({ field }) => (
                                          <FormItem className="space-y-0">
                                            <FormControl>
                                              <RegionSelect
                                                id="checkout-billing-state"
                                                country={watchedBillingCountry}
                                                value={field.value || ""}
                                                onChange={field.onChange}
                                                label={addressFieldLabel("state", t("checkout.state"))}
                                                autoComplete="billing address-level1"
                                              />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                    ) : null}

                                    {addressFieldShown("phone")
                                      ? renderFloatingField(
                                          "billingPhone",
                                          addressFieldLabel("phone", t("checkout.phone")),
                                          "tel",
                                          "billing tel",
                                        )
                                      : null}
                                  </div>
                                ) : null}
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </section>

                  {hasPreorderItems && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/30 dark:bg-blue-500/10">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="checkout-preorder-ack"
                          checked={preorderAccepted}
                          onCheckedChange={(checked) =>
                            setPreorderAccepted(checked === true)
                          }
                          className="mt-0.5"
                        />
                        <Label
                          htmlFor="checkout-preorder-ack"
                          className="cursor-pointer text-sm font-normal leading-5 text-blue-900 dark:text-blue-100"
                        >
                          {preorderDateLabel
                            ? `I understand this cart contains pre-order items expected to ship on or around ${preorderDateLabel}.`
                            : "I understand this cart contains pre-order items that will ship when released."}{" "}
                          {preorderOutstandingAmount > 0
                            ? `Due today: ${formatPrice(preorderDueNow)}. Due before shipping: ${formatPrice(preorderOutstandingAmount)}.`
                            : ""}
                        </Label>
                      </div>
                    </div>
                  )}

                  {/* The card-on-file authorisation. Deliberately its own box
                      and its own tick: the one above is about when the goods
                      arrive, this one hands the store a card to charge later,
                      and a shopper should never give the second away by
                      agreeing to the first. Same treatment as its neighbour so
                      the two read as the pair of terms they are. The wording
                      comes from the module the server composes its stored copy
                      with, so the record matches what was on screen. */}
                  {needsPreorderMandate && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/30 dark:bg-blue-500/10">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="checkout-preorder-mandate"
                          checked={preorderMandateAccepted}
                          onCheckedChange={(checked) =>
                            setPreorderMandateAccepted(checked === true)
                          }
                          className="mt-0.5"
                        />
                        <Label
                          htmlFor="checkout-preorder-mandate"
                          className="cursor-pointer text-sm font-normal leading-5 text-blue-900 dark:text-blue-100"
                        >
                          {preorderMandateText}
                        </Label>
                      </div>
                    </div>
                  )}

                  {/* Submit */}
                  <Button
                    type="submit"
                    className="w-full h-12 gap-2 text-base"
                    size="lg"
                    disabled={
                      isSubmitting ||
                      shippingUnavailable ||
                      shippingRateFailed ||
                      shippingQuotePending ||
                      pickupSelectionRequired ||
                      noPaymentMethodAvailable
                    }
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("common.loading")}
                      </>
                    ) : redirectPaymentProvider ? (
                      <>
                        <PaymentProviderLogo
                          provider={redirectPaymentProvider}
                        />
                        <span>Continue with {redirectPaymentProviderName}</span>
                      </>
                    ) : (
                      t("checkout.completeOrder")
                    )}
                  </Button>

                  {/* Admin-configured policy links + support line (checkout
                      appearance settings). Relative hrefs get the locale
                      prefix; absolute URLs open in a new tab. */}
                  {checkoutSettings.policyLinks.some(
                    (link) => link.visible,
                  ) ? (
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1">
                      {checkoutSettings.policyLinks
                        .filter((link) => link.visible)
                        .map((link, index) =>
                          link.href.startsWith("/") ? (
                            <Link
                              key={`${link.href}-${index}`}
                              href={`/${locale}${link.href}`}
                              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                            >
                              {link.label}
                            </Link>
                          ) : (
                            <a
                              key={`${link.href}-${index}`}
                              href={link.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                            >
                              {link.label}
                            </a>
                          ),
                        )}
                    </div>
                  ) : null}
                  {checkoutSettings.trust.supportText.trim() ? (
                    <p className="pt-1 text-center text-xs text-muted-foreground">
                      {checkoutSettings.trust.supportText}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Right column - Order Summary */}
            <aside className="border-t bg-zinc-50 px-4 py-8 lg:border-t-0 lg:px-12 lg:py-12 dark:bg-background">
              <div
                className="mx-auto max-w-[440px] lg:sticky lg:top-[var(--checkout-summary-offset)] lg:mx-0 lg:max-h-[calc(100dvh-var(--checkout-summary-offset)-1rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
                style={checkoutSummaryStyle}
              >
                <div className="space-y-6">
                  {/* Order summary header */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">
                      {t("checkout.orderSummary")}
                    </h3>
                    <Link
                      href={`/${locale}/cart`}
                      className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      {t("checkout.editCart")}
                    </Link>
                  </div>

                  {/* Summary rows */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {t("common.subtotal")}
                      </span>
                      <span>{formatPrice(subtotal)}</span>
                    </div>
                    {discount > 0 ? (
                      <div className="flex items-center justify-between text-green-700 dark:text-green-400">
                        <span>
                          {t("checkout.discount")}
                          {appliedCoupon ? ` (${appliedCoupon.code})` : ""}
                        </span>
                        <span>-{formatPrice(discount)}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {t("common.shipping")}
                      </span>
                      <span>
                        {shippingDiscount > 0 ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-muted-foreground line-through">
                              {formatPrice(shippingCost)}
                            </span>
                            <span>
                              {discountedShippingCost === 0
                                ? t("common.free")
                                : formatPrice(discountedShippingCost)}
                            </span>
                          </span>
                        ) : discountedShippingCost === 0 ? (
                          t("common.free")
                        ) : (
                          formatPrice(discountedShippingCost)
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {t("checkout.estimatedTax")}
                      </span>
                      <span>{formatPrice(tax)}</span>
                    </div>
                    {hasPreorderItems && preorderOutstandingAmount > 0 ? (
                      <>
                        <div className="flex items-center justify-between text-blue-700 dark:text-blue-300">
                          <span>Pre-order due today</span>
                          <span>{formatPrice(preorderDueNow)}</span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>Due before shipping</span>
                          <span>{formatPrice(preorderOutstandingAmount)}</span>
                        </div>
                      </>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {t("checkout.promoCode")}
                      </span>
                      {!appliedCoupon ? (
                        <span className="text-sm text-muted-foreground">
                          {t("checkout.enterCode")}
                        </span>
                      ) : null}
                    </div>
                    <CouponInput
                      cartItems={couponCartItems}
                      subtotal={subtotal}
                      shippingCost={shippingCost}
                      shippingByVendor={shippingByVendor}
                      appliedCoupon={appliedCouponForDisplay}
                      onApply={(coupon) => setAppliedCoupon(coupon)}
                      onRemove={() => setAppliedCoupon(null)}
                    />
                  </div>

                  <Separator />

                  {/* Total */}
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">
                      {t("common.total")}
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs text-muted-foreground uppercase">
                        {currency.code}
                      </span>
                      <span className="text-2xl font-bold">
                        {formatPrice(total).replace(/[^\d.,]/g, "")}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  {/* Cart items */}
                  <div className="space-y-5">
                    {items.map((item, lineIndex) => {
                      const checkoutItem = item as CheckoutCartItem;
                      const rawVariant =
                        checkoutItem.variantLabel ||
                        (item.name.includes(" - ")
                          ? item.name.split(" - ").slice(1).join(" - ")
                          : "");

                      // Split by common separators and process each part
                      const variantParts = String(rawVariant)
                        .split(/[,|/]/)
                        .map((part) => part.trim())
                        .filter(Boolean);

                      // Check for sale price
                      const compareAtPrice =
                        typeof checkoutItem.compareAtPrice === "number"
                          ? checkoutItem.compareAtPrice
                          : null;
                      const hasDiscount =
                        compareAtPrice !== null && compareAtPrice > item.price;
                      const originalLinePrice =
                        hasDiscount && compareAtPrice !== null
                          ? compareAtPrice * item.quantity
                          : null;

                      const lineKey = `${item.productId}-${item.variantId || ""}`;
                      const isRemovingLine = removingLineKey === lineKey;

                      return (
                        <div
                          key={lineKey}
                          className={cn(
                            "flex items-start gap-4 transition-opacity",
                            isRemovingLine && "opacity-50",
                          )}
                        >
                          <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-muted">
                            {item.image ? (
                              <AppImage
                                src={item.image}
                                alt={item.name}
                                fill
                                className="object-cover"
                              />
                            ) : null}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="font-medium leading-snug mb-1">
                              {item.name.split(" - ")[0]}
                            </p>
                            <div className="space-y-0.5 text-xs text-muted-foreground">
                              {checkoutItem.purchaseType === "preorder" ? (
                                <>
                                  <p className="font-medium text-blue-600 dark:text-blue-300">
                                    {formatPreorderDate(
                                      checkoutItem.preorderReleaseDate,
                                    )
                                      ? `Pre-order - ships around ${formatPreorderDate(
                                          checkoutItem.preorderReleaseDate,
                                        )}`
                                      : "Pre-order"}
                                  </p>
                                  {Number(
                                    checkoutItem.preorderOutstandingAmount || 0,
                                  ) > 0 ? (
                                    // After the coupon, which comes off this
                                    // line's deposit and balance in the same
                                    // proportion — so each shrinks by the
                                    // factor the balance did.
                                    <p>
                                      Due now{" "}
                                      {formatPrice(
                                        Number(checkoutItem.preorderDepositAmount || 0) *
                                          (Number(
                                            preorderOutstandingByLine[lineIndex] ??
                                              checkoutItem.preorderOutstandingAmount ??
                                              0,
                                          ) /
                                            Number(checkoutItem.preorderOutstandingAmount || 1)),
                                      )}{" "}
                                      / later{" "}
                                      {formatPrice(
                                        Number(
                                          preorderOutstandingByLine[lineIndex] ??
                                            checkoutItem.preorderOutstandingAmount ??
                                            0,
                                        ),
                                      )}
                                    </p>
                                  ) : null}
                                </>
                              ) : null}
                              {variantParts.map((part, idx) => (
                                <p key={`${item.productId}-variant-${idx}`}>
                                  {part}
                                </p>
                              ))}
                              <p>Qty: {item.quantity}</p>
                            </div>
                            <div className="mt-1">
                              {hasDiscount ? (
                                <p className="text-sm">
                                  <span className="text-muted-foreground line-through mr-1.5">
                                    {formatPrice(originalLinePrice || 0)}
                                  </span>
                                  <span className="font-semibold text-rose-500">
                                    {formatPrice(item.price * item.quantity)}
                                  </span>
                                </p>
                              ) : (
                                <p className="text-sm font-semibold">
                                  {formatPrice(item.price * item.quantity)}
                                </p>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveLine(
                                lineKey,
                                String(item.productId),
                                item.variantId
                                  ? String(item.variantId)
                                  : undefined,
                              )
                            }
                            disabled={Boolean(removingLineKey)}
                            aria-label={`${t("common.remove")} ${item.name.split(" - ")[0]}`}
                            title={t("common.remove")}
                            className="-mr-1 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-muted"
                          >
                            {isRemovingLine ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {customsDutyAmount > 0 ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {t("checkout.estimatedDuties")}
                      </span>
                      <span>{formatPrice(customsDutyAmount)}</span>
                    </div>
                  ) : null}

                  {deliveryEstimate ? (
                    <div className="text-xs text-muted-foreground">
                      {t("checkout.estimatedDelivery")}
                      : {deliveryEstimate.min}-{deliveryEstimate.max}{" "}
                      {t("checkout.days")}
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </form>
      </Form>
    </div>
  );
}
