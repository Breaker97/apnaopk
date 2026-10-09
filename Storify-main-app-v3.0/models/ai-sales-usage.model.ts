import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * What the AI sales assistant spent, per calendar month (UTC).
 *
 * One row per month, keyed by the month itself (`_id: "2026-09"`): the
 * primary key makes the row unique without an index of its own, so a store
 * that never runs a migration still cannot double-count a month. Every turn
 * `$inc`s the tokens the model reported; the monthly token budget in
 * Settings → AI Sales Agent is checked against `totalTokens` before the model
 * is spoken to — see lib/ai-sales-agent/usage.ts.
 */
export interface IAISalesUsage {
  /** "YYYY-MM", UTC. */
  _id: string;
  /** Model replies — turns the model answered. */
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Turns answered from the catalogue without the model: budget reached, or the model failed. */
  fallbacks: number;
  updatedAt: Date;
}

const AISalesUsageSchema = new Schema<IAISalesUsage>(
  {
    _id: { type: String, required: true },
    requests: { type: Number, default: 0, min: 0 },
    inputTokens: { type: Number, default: 0, min: 0 },
    outputTokens: { type: Number, default: 0, min: 0 },
    totalTokens: { type: Number, default: 0, min: 0 },
    fallbacks: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false, timestamps: { createdAt: false, updatedAt: true } },
);

export const AISalesUsage =
  models.AISalesUsage || model<IAISalesUsage>("AISalesUsage", AISalesUsageSchema);
