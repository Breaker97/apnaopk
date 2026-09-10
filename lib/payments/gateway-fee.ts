/**
 * What the gateway kept.
 *
 * `PaymentTransaction.feeAmount` has existed since the payments feature shipped
 * and every write site hardcoded it to 0, which made `netAmount` a second name
 * for gross and every "net revenue" figure in the product a gross one. A
 * marketplace loses 2–3% of turnover here; on the P&L that is usually larger
 * than any single operating expense.
 *
 * Two things make this fiddly enough to deserve its own module, and both are
 * why the mappers are pure and individually tested:
 *
 * **Units differ per gateway.** Paystack and Razorpay report subunits (kobo,
 * paise), PayPal reports a decimal string, Stripe reports minor units of its
 * BALANCE currency. Reading any of them as a plain number is off by a factor of
 * 100 in the direction that flatters the report.
 *
 * **The fee currency is not always the charge currency.** Stripe settles in the
 * account's balance currency, so a EUR charge on a USD account is billed a USD
 * fee. The pair is therefore carried together and the caller decides what to do
 * when they disagree — never silently subtracted from an amount in another
 * currency.
 */

import { currencyMinorUnitExponent } from "@/lib/intl/money";

export interface GatewayFee {
  /** Major units, in `currency`. */
  amount: number;
  currency: string;
  /**
   * How many units of `currency` one unit of the CHARGE's currency bought, as
   * the gateway itself computed it.
   *
   * Direction matters and is silent when wrong, so it is fixed here and nowhere
   * else: `feeInChargeCurrency = amount / rate`. Only Stripe reports one (its
   * balance transaction states the rate it used to settle the charge); every
   * other gateway bills in the charge's own currency, where no rate is needed.
   *
   * This is the only exchange rate the product can obtain for free and from an
   * authority. It cannot be reconstructed later — the rate on the day is gone —
   * so it is captured with the fee even though nothing reads it yet.
   */
  rate?: number;
}

/** A fee worth recording: finite, non-negative, and in a named currency. */
function toFee(amount: number, currency: unknown): GatewayFee | undefined {
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return undefined;
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return { amount, currency: code };
}

/**
 * Subunits to major units, at the currency's own exponent — never a fixed 100.
 * A JPY or UGX gateway reports whole units already, and dividing those by 100
 * would report a 3,000 UGX fee as 30.
 */
export function feeFromMinorUnits(
  value: unknown,
  currency: unknown,
): GatewayFee | undefined {
  if (typeof value !== "number") return undefined;
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return undefined;
  const exponent = currencyMinorUnitExponent(code);
  return toFee(value / 10 ** exponent, code);
}

/**
 * The `$set` fragment for an order, or nothing at all.
 *
 * Spread into the update that marks the order paid, so the fee is stamped in
 * the SAME write that confirms the payment — a second update would be a second
 * chance to fail, and the gateway response is only in hand once.
 *
 * An unreported fee writes no keys rather than zeroes: absence is the honest
 * record for Pesapal, ioTec, cash, COD and manual orders, and it is what stops
 * a report claiming those charges cost nothing to collect.
 */
export function gatewayFeeUpdate(
  fee: GatewayFee | undefined,
):
  | { paymentFee: number; paymentFeeCurrency: string; paymentFeeRate?: number }
  | Record<string, never> {
  if (!fee) return {};
  return {
    paymentFee: fee.amount,
    paymentFeeCurrency: fee.currency,
    ...(fee.rate === undefined ? {} : { paymentFeeRate: fee.rate }),
  };
}

/** Paystack `transaction.verify` → `data.fees`, in subunits of the charge currency. */
export function paystackFee(transaction: {
  fees?: number | null;
  currency?: string | null;
}): GatewayFee | undefined {
  return feeFromMinorUnits(transaction?.fees ?? undefined, transaction?.currency);
}

/**
 * Razorpay `payments/:id` → `fee`, in subunits.
 *
 * `fee` is the total Razorpay keeps and ALREADY INCLUDES the `tax` line, so
 * adding tax on top double-counts the GST portion.
 */
export function razorpayFee(payment: {
  fee?: number | null;
  /** Declared so the "already included in `fee`" rule is visible at the call site. */
  tax?: number | null;
  currency?: string | null;
}): GatewayFee | undefined {
  return feeFromMinorUnits(payment?.fee ?? undefined, payment?.currency);
}

/**
 * PayPal capture → `seller_receivable_breakdown.paypal_fee`, a decimal STRING
 * with its own currency code (which is the payout currency, not necessarily the
 * charge currency on a cross-border sale).
 */
export function paypalFee(captureResponse: unknown): GatewayFee | undefined {
  const capture = (
    captureResponse as {
      purchase_units?: Array<{
        payments?: {
          captures?: Array<{
            seller_receivable_breakdown?: {
              paypal_fee?: { value?: string; currency_code?: string };
            };
          }>;
        };
      }>;
    }
  )?.purchase_units?.[0]?.payments?.captures?.[0];

  const paypalFeeNode = capture?.seller_receivable_breakdown?.paypal_fee;
  if (!paypalFeeNode) return undefined;
  return toFee(Number(paypalFeeNode.value), paypalFeeNode.currency_code);
}

/**
 * Stripe balance transaction → `fee`, in minor units of the BALANCE currency.
 *
 * Not the charge's currency: Stripe converts and settles into the account's
 * balance, and the fee is expressed there. `fee_details` is deliberately
 * ignored — it itemizes the same total.
 */
export function stripeFee(balanceTransaction: {
  fee?: number | null;
  currency?: string | null;
  /** Present only when Stripe converted the charge into the balance currency. */
  exchange_rate?: number | null;
}): GatewayFee | undefined {
  const fee = feeFromMinorUnits(
    balanceTransaction?.fee ?? undefined,
    balanceTransaction?.currency,
  );
  if (!fee) return undefined;

  const rate = balanceTransaction?.exchange_rate;
  if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
    fee.rate = rate;
  }
  return fee;
}

/**
 * A foreign fee expressed in the charge's own currency, or undefined when that
 * cannot be stated honestly.
 *
 * Undefined is the important half. With no rate there is no defensible number,
 * and the alternative — treating 2.59 USD as 2.59 EUR because both are "money"
 * — produces a figure that looks right and is not. A report can say "fee not
 * convertible" from undefined; it cannot recover from a bad conversion.
 */
export function feeInChargeCurrency(params: {
  fee?: number | null;
  feeCurrency?: string | null;
  chargeCurrency?: string | null;
  rate?: number | null;
}): number | undefined {
  const fee = Number(params.fee);
  if (!Number.isFinite(fee) || fee < 0) return undefined;

  const from = String(params.feeCurrency || "").trim().toUpperCase();
  const to = String(params.chargeCurrency || "").trim().toUpperCase();
  if (!to) return undefined;
  // Billed in the charge's own currency: nothing to convert.
  if (!from || from === to) return fee;

  const rate = Number(params.rate);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return fee / rate;
}
