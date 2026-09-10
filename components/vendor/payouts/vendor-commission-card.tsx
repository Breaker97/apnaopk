"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Banknote, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import { loadRazorpayCheckoutScript } from "@/components/checkout/checkout-helpers";
import {
  PaymentMethodPicker,
  type PlatformGateway,
} from "@/components/vendor/payment-method-picker";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * The vendor's side of a commission invoice.
 *
 * The admin can raise one and mark it collected out-of-band; until now that was
 * the only end that existed, so a merchant who wanted to settle the debt inside
 * the app could not — /api/vendor/commission was implemented and unreachable.
 * This is the surface that closes it, on the payouts screen because that is
 * where the merchant already goes to see money moving between them and the
 * platform (every other figure there is the platform owing them; this is the
 * one that runs the other way).
 */

interface CommissionInvoiceRow {
  id: string;
  amount: number;
  currency: string;
  orderCount: number;
  note: string | null;
  createdAt: string;
}

interface CommissionResponse {
  paymentMethods: PlatformGateway[];
  invoices: CommissionInvoiceRow[];
}

interface InitiationResponse {
  paymentId: string;
  provider: PlatformGateway;
  type: "redirect" | "razorpay" | "polling";
  url?: string;
  keyId?: string;
  razorpayOrderId?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  prefill?: { email?: string; name?: string; contact?: string };
}

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 45;

export function VendorCommissionCard({ locale }: { locale: string }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { formatPrice } = useCurrency();
  const label = useFallbackTranslator(t);

  const [data, setData] = useState<CommissionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [payingInvoice, setPayingInvoice] =
    useState<CommissionInvoiceRow | null>(null);
  const [method, setMethod] = useState<PlatformGateway | null>(null);
  const [iotecChannel, setIotecChannel] = useState<"mobile_money" | "card">(
    "mobile_money",
  );
  const [iotecPhone, setIotecPhone] = useState("");
  const [mtnMomoPhone, setMtnMomoPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const verifiedRef = useRef(false);

  const load = useCallback(
    () =>
      apiClient
        .get<CommissionResponse>("/api/vendor/commission")
        .then((res) => setData(res))
        .catch(() => {
          // A vendor with no commission rail (single-vendor mode, or no
          // permission) simply gets no card — this is an optional panel, not
          // a page failure.
          setData(null);
        })
        .finally(() => setIsLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Return-from-gateway verification (once). The IPN/webhook settles the
  // invoice on its own schedule; this is what makes the debt clear while the
  // vendor is still looking at the screen.
  useEffect(() => {
    const paymentId = searchParams.get("commission_payment");
    const canceled = searchParams.get("canceled");
    if (!paymentId || verifiedRef.current) return;
    verifiedRef.current = true;

    const cleanUrl = () => {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of [
        "commission_payment",
        "canceled",
        "session_id",
        "reference",
        "trxref",
        "OrderTrackingId",
        "OrderMerchantReference",
      ]) {
        params.delete(key);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    };

    if (canceled) {
      toast.info(
        label(
          "vendor.commission.canceled",
          "Payment was canceled. The invoice is still open.",
        ),
      );
      cleanUrl();
      return;
    }

    apiClient
      .post<{ paid: boolean }>("/api/vendor/commission/verify", { paymentId })
      .then(({ paid }) => {
        toast[paid ? "success" : "info"](
          paid
            ? label("vendor.commission.settled", "Commission invoice settled.")
            : label(
                "vendor.commission.pendingInfo",
                "Payment is still processing — the invoice clears automatically once confirmed.",
              ),
        );
      })
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : label(
                "vendor.commission.verifyFailed",
                "We could not confirm that payment yet.",
              ),
        ),
      )
      .finally(() => {
        cleanUrl();
        void load();
        router.refresh();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollVerify = useCallback(
    async (paymentId: string) => {
      setIsPolling(true);
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          const result = await apiClient.post<{ paid: boolean }>(
            "/api/vendor/commission/verify",
            { paymentId },
          );
          if (result.paid) {
            setIsPolling(false);
            setPayingInvoice(null);
            toast.success(
              label("vendor.commission.settled", "Commission invoice settled."),
            );
            await load();
            router.refresh();
            return;
          }
        } catch {
          // Transient poll errors are expected while the payer approves.
        }
      }
      setIsPolling(false);
      setPayingInvoice(null);
      toast.error(
        label(
          "vendor.commission.pollTimeout",
          "We could not confirm the payment yet. The invoice clears automatically once it is confirmed.",
        ),
      );
      await load();
      router.refresh();
    },
    [label, load, router],
  );

  const handlePay = useCallback(async () => {
    if (!payingInvoice || !method) return;
    setIsSubmitting(true);
    try {
      const response = await apiClient.post<InitiationResponse>(
        "/api/vendor/commission",
        {
          invoiceId: payingInvoice.id,
          paymentMethod: method,
          locale,
          ...(method === "iotec"
            ? { iotecChannel, iotecPhone: iotecPhone || undefined }
            : {}),
          ...(method === "mtn_momo"
            ? { mtnMomoPhone: mtnMomoPhone || undefined }
            : {}),
        },
      );

      if (response.type === "redirect" && response.url) {
        window.location.assign(response.url);
        return;
      }

      if (response.type === "razorpay" && response.razorpayOrderId) {
        await loadRazorpayCheckoutScript();
        const Razorpay = (
          window as unknown as {
            Razorpay?: new (options: Record<string, unknown>) => {
              open: () => void;
              on: (event: string, cb: (r: unknown) => void) => void;
            };
          }
        ).Razorpay;
        if (!Razorpay) throw new Error("Razorpay checkout is unavailable");
        const payload = await new Promise<{
          razorpay_payment_id: string;
          razorpay_signature: string;
        }>((resolve, reject) => {
          let settled = false;
          const razorpay = new Razorpay({
            key: response.keyId,
            amount: response.amount,
            currency: response.currency,
            name: response.name,
            description: response.description,
            order_id: response.razorpayOrderId,
            prefill: response.prefill,
            handler: (result: unknown) => {
              settled = true;
              resolve(
                result as {
                  razorpay_payment_id: string;
                  razorpay_signature: string;
                },
              );
            },
            modal: {
              ondismiss: () => {
                if (!settled) {
                  reject(
                    new Error(
                      label(
                        "vendor.commission.canceled",
                        "Payment was canceled. The invoice is still open.",
                      ),
                    ),
                  );
                }
              },
            },
          });
          razorpay.on("payment.failed", (result: unknown) => {
            settled = true;
            const failure = result as {
              error?: { description?: string; reason?: string };
            };
            reject(
              new Error(
                failure.error?.description ||
                  failure.error?.reason ||
                  "Razorpay payment failed",
              ),
            );
          });
          razorpay.open();
        });

        const verify = await apiClient.post<{ paid: boolean }>(
          "/api/vendor/commission/verify",
          {
            paymentId: response.paymentId,
            razorpayPaymentId: payload.razorpay_payment_id,
            razorpaySignature: payload.razorpay_signature,
          },
        );
        if (!verify.paid) {
          throw new Error(
            label(
              "vendor.commission.verifyFailed",
              "We could not confirm that payment yet.",
            ),
          );
        }
        toast.success(
          label("vendor.commission.settled", "Commission invoice settled."),
        );
        setPayingInvoice(null);
        await load();
        router.refresh();
        return;
      }

      if (response.type === "polling") {
        toast.info(
          label(
            "vendor.commission.checkPhone",
            "Check your phone and approve the payment request.",
          ),
        );
        await pollVerify(response.paymentId);
        return;
      }

      throw new Error(
        label("vendor.commission.failed", "Failed to start the payment"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label("vendor.commission.failed", "Failed to start the payment"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    payingInvoice,
    method,
    locale,
    iotecChannel,
    iotecPhone,
    mtnMomoPhone,
    label,
    load,
    pollVerify,
    router,
  ]);

  const invoices = data?.invoices ?? [];
  const methods = data?.paymentMethods ?? [];

  // Nothing owed is the normal state; a card explaining that on every visit is
  // noise, so the panel only exists when there is a debt to settle.
  if (isLoading) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (invoices.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            {label("vendor.commission.title", "Commission you owe")}
          </CardTitle>
          <CardDescription>
            {label(
              "vendor.commission.subtitle",
              "Commission on sales you collected yourself — cash, COD or your own terminal — so it could not be deducted from a payout.",
            )}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="divide-y rounded-lg border">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">
                    {formatPrice(invoice.amount)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {invoice.orderCount.toLocaleString()} order
                    {invoice.orderCount === 1 ? "" : "s"} ·{" "}
                    {new Date(invoice.createdAt).toLocaleDateString()}
                    {invoice.note ? ` · ${invoice.note}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={methods.length === 0}
                  onClick={() => {
                    setPayingInvoice(invoice);
                    setMethod(methods.length === 1 ? methods[0] : null);
                  }}
                >
                  {label("vendor.commission.payNow", "Pay now")}
                </Button>
              </div>
            ))}
          </div>
          {methods.length === 0 ? (
            <p className="pt-3 text-sm text-muted-foreground">
              {label(
                "vendor.commission.noMethods",
                "No payment method is available for this. Contact the marketplace admin to settle it another way.",
              )}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(payingInvoice)}
        onOpenChange={(open) => {
          if (isPolling || isSubmitting) return;
          if (!open) setPayingInvoice(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {label("vendor.commission.dialogTitle", "Settle commission")}
            </DialogTitle>
            <DialogDescription>
              {payingInvoice
                ? `${formatPrice(payingInvoice.amount)} · ${payingInvoice.orderCount.toLocaleString()} order${
                    payingInvoice.orderCount === 1 ? "" : "s"
                  }`
                : null}
            </DialogDescription>
          </DialogHeader>

          {isPolling ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {label(
                  "vendor.commission.checkPhone",
                  "Check your phone and approve the payment request.",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <PaymentMethodPicker
                methods={methods}
                value={method}
                onChange={setMethod}
                iotecChannel={iotecChannel}
                onIotecChannelChange={setIotecChannel}
                iotecPhone={iotecPhone}
                onIotecPhoneChange={setIotecPhone}
                mtnMomoPhone={mtnMomoPhone}
                onMtnMomoPhoneChange={setMtnMomoPhone}
              />
              <div className="flex justify-end pt-2">
                <Button
                  disabled={
                    !method ||
                    isSubmitting ||
                    (method === "iotec" &&
                      iotecChannel === "mobile_money" &&
                      !iotecPhone.trim()) ||
                    (method === "mtn_momo" && !mtnMomoPhone.trim())
                  }
                  onClick={handlePay}
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {label("vendor.commission.continue", "Continue to payment")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
