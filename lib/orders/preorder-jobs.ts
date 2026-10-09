import { processPreorderOperations } from "@/lib/orders/preorder-operations";
import {
  catchUpPreorderTerms,
  deliverPendingDateNotices,
  runPreorderDateSyncJobs,
} from "@/lib/orders/preorder-terms-sync";
import { processPreorderBalanceNotices } from "@/lib/orders/preorder-notice";
import { chargeDuePreorderBalances } from "@/lib/payments/preorder-balance-charge";
import { ensureReleaseOperations } from "@/lib/orders/preorder-release";
import { getTransactionSupport } from "@/lib/db-transaction";

/**
 * The frequent passes, in the order the specification sets out: resume what
 * was interrupted, bring dates up to date, send notices, charge only what has
 * matured, then recover paid releases. Each is bounded; the budget is shared,
 * and whatever does not fit continues on the next run.
 */
export async function runPreorderFrequentPasses(options: { budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = options.budgetMs ?? 45_000;
  const left = () => Math.max(1_000, budget - (Date.now() - started));
  const support = await getTransactionSupport();

  // 1. Lifecycle effects still owed (refunds, labels, notices, releases).
  const operations = await processPreorderOperations({ budgetMs: Math.min(left(), 15_000) });
  // 2. Date propagation, its owed notices, and new orders nothing checked.
  const dateSync = await runPreorderDateSyncJobs({ budgetMs: Math.min(left(), 15_000) });
  const dateNotices = await deliverPendingDateNotices();
  const catchUp = await catchUpPreorderTerms();
  // 3. Advance notices: send, or confirm what the mail server did.
  const notices = await processPreorderBalanceNotices();
  // 4. Saved-card charges whose notice window has passed.
  const charges = await chargeDuePreorderBalances();
  // 5. Paid releases: create any operation a crash left missing, then run
  //    the due ones (stock may have arrived since the last attempt).
  const releasesRecreated = await ensureReleaseOperations();
  const releases = await processPreorderOperations({
    budgetMs: Math.min(left(), 10_000),
    kinds: ["release"],
  });

  return {
    transactions: support.supported ? "available" : `unavailable: ${support.reason}`,
    operations,
    dateSync,
    dateNotices,
    catchUp,
    notices,
    charges,
    releasesRecreated,
    releases,
  };
}
