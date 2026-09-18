import Link from "next/link";
import { CalendarCheck, HandCoins } from "lucide-react";

/**
 * How this store collects the second half of a deposit pre-order.
 *
 * Whether the balance is asked for automatically is a STORE policy, not a
 * per-order or per-vendor one — the charge lands on the platform's gateway and
 * the refund and the chargeback arrive there too, which is the same reason
 * release dates and deposit sizes are bounded centrally (`preorder-gating.ts`).
 *
 * But a vendor watching this queue has to know which world they are in. With
 * automation on, orders move and shoppers are charged without anybody
 * clicking, and a vendor who did not know that would keep working a queue that
 * empties itself — or wonder who asked their customer for money. With it off,
 * nothing at all happens until somebody clicks, and an order sitting on
 * "Reserved" past its date is waiting for them, not for a job.
 *
 * Stating it costs one line and answers the only question the page cannot
 * otherwise answer.
 */
export function PreorderBalancePolicyNotice(props: {
  autoRelease: boolean;
  autoReleaseDelayDays: number;
  /** Admins get the way to change it; vendors get the fact. */
  settingsHref?: string;
}) {
  const when =
    props.autoReleaseDelayDays > 0
      ? `${props.autoReleaseDelayDays} day${
          props.autoReleaseDelayDays === 1 ? "" : "s"
        } after the expected date`
      : "on the expected date";

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-muted/40 p-4">
      <span className="mt-0.5 text-muted-foreground">
        {props.autoRelease ? (
          <CalendarCheck className="h-4 w-4" />
        ) : (
          <HandCoins className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">
          {props.autoRelease
            ? `Balances are requested automatically, ${when}`
            : "Balances are only requested when you ask for them"}
        </p>
        <p className="text-muted-foreground text-xs">
          {props.autoRelease
            ? "A saved card is charged on the spot; anyone without one is emailed a link to pay. Pre-orders already paid in full are released for fulfilment as soon as their stock is recorded. You can still ask earlier with Request balance."
            : "Use Request balance on a pre-order, or mark it ready, once its stock is in. Nothing is collected and nothing moves until then."}
          {props.settingsHref ? (
            <>
              {" "}
              <Link
                href={props.settingsHref}
                className="underline underline-offset-2"
              >
                Change this in Settings
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
