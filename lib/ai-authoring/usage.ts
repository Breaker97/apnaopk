import { RateLimitError } from "@/lib/api/errors";
import { connectDB } from "@/lib/db";
import { AIUsage } from "@/models/ai-usage.model";

export type AIUsageKind = "text" | "image";

/** UTC calendar day, so a cap can't be reset by changing the local timezone. */
function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Count one generation for the user and enforce the daily cap atomically.
 *
 * With a cap, the increment only matches a day-row still under the limit; when
 * the row is at the limit the filtered upsert collides with the unique
 * (userId, day) index and surfaces as a duplicate-key error — i.e. cap
 * reached — without a read-then-write race. limit <= 0 means unlimited: the
 * counter still increments so the settings page can show usage.
 */
export async function consumeAIUsage(
  userId: string,
  kind: AIUsageKind,
  limit: number,
): Promise<void> {
  await connectDB();
  const day = usageDay();
  const field = kind === "image" ? "imageCount" : "textCount";

  if (limit <= 0) {
    await AIUsage.updateOne(
      { userId, day },
      { $inc: { [field]: 1 } },
      { upsert: true },
    );
    return;
  }

  try {
    const updated = await AIUsage.findOneAndUpdate(
      { userId, day, [field]: { $lt: limit } },
      { $inc: { [field]: 1 } },
      { upsert: true, new: true },
    );
    if (!updated) throw new RateLimitError(capMessage(kind));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new RateLimitError(capMessage(kind));
    }
    throw error;
  }
}

function capMessage(kind: AIUsageKind): string {
  return kind === "image"
    ? "Daily AI image limit reached. Try again tomorrow or ask an admin to raise the limit."
    : "Daily AI text limit reached. Try again tomorrow or ask an admin to raise the limit.";
}

