import "server-only";
import type { PipelineStage } from "mongoose";
import { FinanceOperation } from "@/models/finance-operation.model";

/** Profit coverage requires verified posted cost, not just a committed allocation. */
export function completedInventoryPostingEvidence(sourceId: string): PipelineStage[] {
  return [
    { $set: { _postingSourceId: { $toString: sourceId } } },
    { $lookup: { from: FinanceOperation.collection.name, localField: "_postingSourceId", foreignField: "sourceId", as: "_postingEvidence" } },
    { $match: { "_postingEvidence.state": "complete" } },
  ];
}

export async function getInventoryPostingCoverage(asOf: Date) {
  const rows = await FinanceOperation.aggregate<{ _id: string; operations: Array<{ id: unknown; state: string }> }>([
    { $match: { state: { $in: ["pending", "conflict"] } } },
    { $unwind: "$postings" },
    { $match: { "postings.book": "own", "postings.date": { $lte: asOf } } },
    { $group: { _id: "$postings.currency", operations: { $addToSet: { id: "$_id", state: "$state" } } } },
  ]);
  return rows.map((row) => ({ currency: row._id, pending: row.operations.filter((op) => op.state === "pending").length, conflicts: row.operations.filter((op) => op.state === "conflict").length }));
}
