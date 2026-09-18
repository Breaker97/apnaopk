import { connectDB } from "@/lib/db";
import { AISalesUsage, type IAISalesUsage } from "@/models/ai-sales-usage.model";

/**
 * The assistant's token spend, and the monthly budget over it.
 *
 * A merchant puts their own OpenAI key in; the bill is theirs, and a bot or
 * a viral week could run it up while nobody watches. The budget is a number
 * of tokens per calendar month (0 = unlimited) — tokens rather than money,
 * so there is no per-model price table to keep current. Once it is reached
 * the assistant stops calling the model and answers from the catalogue
 * instead (see engine.ts), until the month turns.
 */

export type AISalesMonthlyUsage = Pick<
  IAISalesUsage,
  "requests" | "inputTokens" | "outputTokens" | "totalTokens" | "fallbacks"
> & { month: string };

/** The calendar month a moment falls in, UTC, as "YYYY-MM". */
export function usageMonth(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Whether a budget is set (0 means none) and the month has used it up. */
export function isTokenBudgetExhausted(budget: number, usedTokens: number): boolean {
  return Number.isFinite(budget) && budget > 0 && usedTokens >= budget;
}

const EMPTY: Omit<AISalesMonthlyUsage, "month"> = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  fallbacks: 0,
};

export async function getAISalesUsage(
  month: string = usageMonth(),
): Promise<AISalesMonthlyUsage> {
  await connectDB();
  const row = await AISalesUsage.findById(month).lean<IAISalesUsage | null>();
  return {
    month,
    requests: row?.requests ?? EMPTY.requests,
    inputTokens: row?.inputTokens ?? EMPTY.inputTokens,
    outputTokens: row?.outputTokens ?? EMPTY.outputTokens,
    totalTokens: row?.totalTokens ?? EMPTY.totalTokens,
    fallbacks: row?.fallbacks ?? EMPTY.fallbacks,
  };
}

/**
 * Add one turn to the month. Never throws into the chat: a counter that
 * cannot be written is logged, and the customer still gets their reply.
 */
export async function recordAISalesUsage(turn: {
  inputTokens: number;
  outputTokens: number;
  /** The turn was answered from the catalogue, without the model. */
  fallback: boolean;
}): Promise<void> {
  const spent = turn.inputTokens + turn.outputTokens;
  if (spent <= 0 && !turn.fallback) return;
  try {
    await connectDB();
    await AISalesUsage.updateOne(
      { _id: usageMonth() },
      {
        $inc: {
          requests: spent > 0 ? 1 : 0,
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          totalTokens: spent,
          fallbacks: turn.fallback ? 1 : 0,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    console.error("[ai-sales-agent] could not record token usage", error);
  }
}

const BUDGET_WARNING_INTERVAL_MS = 10 * 60 * 1000;
let budgetWarnedAt = 0;

/** One log line every ten minutes while the budget is exhausted, not one per chat. */
export function warnTokenBudgetExhausted(budget: number, usage: AISalesMonthlyUsage): void {
  const now = Date.now();
  if (now - budgetWarnedAt < BUDGET_WARNING_INTERVAL_MS) return;
  budgetWarnedAt = now;
  console.warn(
    `[ai-sales-agent] monthly token budget reached (${usage.totalTokens} of ${budget} tokens in ${usage.month}); answering from the catalogue without the model until next month.`,
  );
}
