/**
 * The rules of an address hold, with no database and no network.
 *
 * A courier cannot deliver to the address on an order — the carrier refused the
 * label, or a check after the order was placed could not find the address. The
 * order is not cancelled and not quietly dropped: shipping is paused, the
 * customer is asked to correct the address, reminded, and only when a deadline
 * passes does the store decide (or have decided in advance) to cancel. A
 * customer who says the address is right is never cancelled on a timer: the
 * courier and the customer disagree, and only a person can settle that.
 *
 * This is the shape large stores converge on — Shopify's address validation
 * with a fulfilment hold, Amazon's ask-then-cancel on an undeliverable address —
 * and it lives here so the order screens, the customer page, the cron and the
 * shipping guards read one definition of "on hold" and one schedule.
 */

export const ADDRESS_HOLD_REASONS = ["carrier_refused", "validation_failed", "store"] as const;
export type AddressHoldReason = (typeof ADDRESS_HOLD_REASONS)[number];

export const ADDRESS_HOLD_RELEASES = [
  "address_changed",
  "store_edited",
  "store_confirmed",
  "order_cancelled",
] as const;
export type AddressHoldRelease = (typeof ADDRESS_HOLD_RELEASES)[number];

type AddressHoldDeadlineAction = "notify" | "cancel";

export interface AddressHold {
  state: "open" | "released";
  reason: AddressHoldReason;
  /** Why the address can't be delivered to, in words a customer can act on. */
  message?: string;
  placedAt: Date | string;
  placedBy?: string;
  /** When the customer was first asked; the deadline counts from here. */
  requestedAt?: Date | string;
  requestsSent?: number;
  lastRequestAt?: Date | string;
  deadlineAt?: Date | string;
  /** Set once the deadline passed, so the store is told (or the order cancelled) once. */
  expiredAt?: Date | string;
  /** The customer says the address is right as it is; the store decides. */
  customerConfirmedAt?: Date | string;
  releasedAt?: Date | string;
  releasedBy?: string;
  releaseReason?: AddressHoldRelease;
}

export interface AddressHoldSettings {
  /** "Did you mean…" at checkout, when a carrier is connected to ask. */
  suggestAtCheckout: boolean;
  /** Check the address once an order is placed, before anyone buys a label. */
  checkAfterOrder: boolean;
  /** Email the customer a correction link as soon as a hold is placed. */
  autoRequest: boolean;
  /** Days after the first request on which a reminder goes out. */
  reminderDays: number[];
  /** Days after the first request the customer has to answer. */
  deadlineDays: number;
  onDeadline: AddressHoldDeadlineAction;
  /** A parcel returned as undeliverable keeps its return shipping from the refund. */
  keepReturnShipping: boolean;
}

export const DEFAULT_ADDRESS_HOLD_SETTINGS: AddressHoldSettings = {
  suggestAtCheckout: true,
  checkAfterOrder: true,
  autoRequest: true,
  reminderDays: [1, 3],
  deadlineDays: 7,
  // Telling the store is the safe default: cancelling on a timer refunds and
  // restocks without a person looking, which a store should opt into.
  onDeadline: "notify",
  keepReturnShipping: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DEADLINE_DAYS = 60;

function wholeDays(value: unknown, min: number, max: number): number | undefined {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

/** Stored settings with every gap filled and every number made sane. */
export function resolveAddressHoldSettings(
  stored: Partial<AddressHoldSettings> | null | undefined,
): AddressHoldSettings {
  const defaults = DEFAULT_ADDRESS_HOLD_SETTINGS;
  const deadlineDays =
    wholeDays(stored?.deadlineDays, 1, MAX_DEADLINE_DAYS) ?? defaults.deadlineDays;
  const reminderDays = Array.isArray(stored?.reminderDays)
    ? Array.from(
        new Set(
          stored!.reminderDays
            .map((day) => wholeDays(day, 1, MAX_DEADLINE_DAYS))
            // A reminder on or after the deadline would arrive with nothing
            // left to do.
            .filter((day): day is number => day !== undefined && day < deadlineDays),
        ),
      ).sort((a, b) => a - b)
    : defaults.reminderDays.filter((day) => day < deadlineDays);

  const bool = (key: keyof AddressHoldSettings, fallback: boolean) =>
    typeof stored?.[key] === "boolean" ? (stored[key] as boolean) : fallback;

  return {
    suggestAtCheckout: bool("suggestAtCheckout", defaults.suggestAtCheckout),
    checkAfterOrder: bool("checkAfterOrder", defaults.checkAfterOrder),
    autoRequest: bool("autoRequest", defaults.autoRequest),
    reminderDays,
    deadlineDays,
    onDeadline: stored?.onDeadline === "cancel" ? "cancel" : "notify",
    keepReturnShipping: bool("keepReturnShipping", defaults.keepReturnShipping),
  };
}

/** True while shipping must wait on the address. */
export function isAddressHoldOpen(
  order: { addressHold?: Pick<AddressHold, "state"> | null } | null | undefined,
): boolean {
  return order?.addressHold?.state === "open";
}

export const ADDRESS_HOLD_SHIPPING_BLOCK =
  "Shipping is on hold until the delivery address is corrected or confirmed.";

/** The deadline for a request first sent at `requestedAt`. */
export function addressHoldDeadline(
  requestedAt: Date | string,
  settings: Pick<AddressHoldSettings, "deadlineDays">,
): Date {
  return new Date(new Date(requestedAt).getTime() + settings.deadlineDays * DAY_MS);
}

type AddressHoldDue =
  | { kind: "none" }
  | { kind: "reminder"; number: number }
  | { kind: "deadline" };

/**
 * What an open hold is owed at `now`.
 *
 * Reminders are counted, not timestamped per day: `requestsSent` includes the
 * first request, so the n-th reminder is due once `reminderDays[n-1]` days have
 * passed and fewer than n + 1 messages have gone. A cron that misses a day sends
 * the one reminder that is due, not a burst of every reminder it slept through.
 *
 * A customer who said the address is right as it is has answered, so no more
 * reminders go to them. The deadline still comes due, for the store.
 */
export function addressHoldDue(
  hold: AddressHold | null | undefined,
  settings: Pick<AddressHoldSettings, "reminderDays">,
  now: Date = new Date(),
): AddressHoldDue {
  if (!hold || hold.state !== "open" || hold.expiredAt) return { kind: "none" };
  if (!hold.requestedAt) return { kind: "none" };

  const requested = new Date(hold.requestedAt).getTime();
  const elapsed = now.getTime() - requested;
  if (hold.deadlineAt && now.getTime() >= new Date(hold.deadlineAt).getTime()) {
    return { kind: "deadline" };
  }
  // Asking again would read as though they had not answered.
  if (hold.customerConfirmedAt) return { kind: "none" };

  const sent = Math.max(1, Number(hold.requestsSent) || 1);
  const passed = settings.reminderDays.filter((day) => elapsed >= day * DAY_MS).length;
  // `sent - 1` reminders have gone. Only the latest one due is sent.
  if (passed > sent - 1) return { kind: "reminder", number: passed };
  return { kind: "none" };
}

/** One line for a customer or a timeline: "1 Ferry Building, San Francisco, 94111". */
export function addressSummary(
  address: { street?: string; apartment?: string; city?: string; postalCode?: string } | null | undefined,
): string {
  return [address?.street, address?.apartment, address?.city, address?.postalCode]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}
