import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter =
  models.Counter || model<ICounter>("Counter", CounterSchema);

// Counter names whose existence this process has already verified. The seed is a
// one-time migration concern, so once we've confirmed (or created) a counter we
// never need the pre-check again — this collapses a per-order `findById` to at
// most one per counter name per process (there are only a couple of names).
const verifiedCounters = new Set<string>();

/**
 * Atomically increment a named sequence and return the next value.
 * Uses findOneAndUpdate with $inc + upsert so concurrent callers each
 * receive a unique, monotonically increasing value.
 *
 * If `seedIfMissing` is provided and the counter does not yet exist, it
 * is initialised to the seed value before being incremented. This is how
 * existing installations migrate from countDocuments-based numbering: the
 * caller passes max(existing) so the first call returns max+1 instead of 1.
 */
export async function getNextSequence(
  name: string,
  seedIfMissing?: () => Promise<number> | number,
): Promise<number> {
  if (seedIfMissing && !verifiedCounters.has(name)) {
    const existing = await Counter.findById(name).select("_id").lean();
    if (!existing) {
      const seed = await seedIfMissing();
      // setOnInsert avoids overwriting if a concurrent caller created the
      // counter in the meantime — that caller's seed wins, ours is ignored.
      await Counter.updateOne(
        { _id: name },
        { $setOnInsert: { seq: Math.max(0, Number(seed) || 0) } },
        { upsert: true },
      );
    }
    // Only set after a successful check/seed; if either threw, we retry next call.
    verifiedCounters.add(name);
  }

  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return doc.seq;
}
