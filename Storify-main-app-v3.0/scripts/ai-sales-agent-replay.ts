import { connectDB, disconnectDB, mongoose } from "@/lib/db";
import { AISalesConversation } from "@/models";
import { getSettings } from "@/models/settings.model";
import { normalizeAISalesAgentSettings } from "@/lib/ai-sales-agent/settings";
import { aiSalesToolHandlers } from "@/lib/ai-sales-agent/tools";
import type { AISalesToolContext } from "@/lib/ai-sales-agent/types";

/**
 * AI sales agent — replay a conversation's searches
 * ==================================================
 *
 * "The assistant told a shopper we don't sell X" is a retrieval question
 * before it is a model question: what did search_products hand the model?
 * This takes one saved conversation, prints its timeline, and re-runs every
 * search the model made against today's catalogue and today's code — so a
 * fix is checked against the exact turn a customer complained about, and a
 * live complaint is diagnosed in a minute rather than an hour.
 *
 * Reads only: the tool runs as a replay, so no miss is counted in Search
 * insights, and the conversation itself is never written.
 *
 * Usage:
 *   pnpm ai-agent:replay <conversation id | session id>
 *   pnpm ai-agent:replay <id> --locale bn      # product URLs in that locale
 *
 * The conversation id is what Admin → AI Sales Agent → Conversations shows;
 * the session id (the widget's `conversationId`) works too.
 */

type SavedMessage = { role?: string; content?: string; createdAt?: Date };
type SavedAction = {
  type?: string;
  name?: string;
  payload?: { content?: unknown } | null;
  createdAt?: Date;
};
type SavedConversation = {
  _id: unknown;
  sessionId?: string;
  locale?: string;
  createdAt?: Date;
  messages?: SavedMessage[];
  actions?: SavedAction[];
};

/** The part of the search tool's JSON a replay needs: the arguments it echoes, and the verdict. */
type SavedSearch = {
  match?: string;
  query?: string;
  budget?: { minPrice?: number; maxPrice?: number };
  category?: { requested?: string };
  products?: Array<{ name?: string }>;
};

type TimelineEntry =
  | { at: number; kind: "message"; message: SavedMessage }
  | { at: number; kind: "action"; action: SavedAction };

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function time(value: Date | undefined): string {
  return value ? new Date(value).toISOString().slice(11, 19) : "--:--:--";
}

function oneLine(value: unknown, max = 160): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseSavedSearch(payload: SavedAction["payload"]): SavedSearch | null {
  if (typeof payload?.content !== "string") return null;
  try {
    const parsed = JSON.parse(payload.content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SavedSearch) : null;
  } catch {
    return null;
  }
}

function describeVerdict(search: SavedSearch): string {
  const names = (search.products || []).map((product) => product.name || "?");
  return `${search.match ?? "?"}  [${names.join(" | ")}]`;
}

async function main() {
  const id = process.argv.slice(2).find((value) => !value.startsWith("--"));
  if (!id) {
    console.error("Usage: pnpm ai-agent:replay <conversation id | session id> [--locale xx]");
    process.exit(1);
  }

  await connectDB();
  const conversation = (mongoose.isValidObjectId(id)
    ? await AISalesConversation.findById(id).lean<SavedConversation | null>()
    : null) ??
    (await AISalesConversation.findOne({ sessionId: id }).lean<SavedConversation | null>());
  if (!conversation) {
    console.error(`No conversation with id or session id "${id}".`);
    process.exit(1);
  }

  const settings = await getSettings();
  const ctx: AISalesToolContext = {
    locale: argument("--locale") || conversation.locale || "en",
    origin: "",
    sessionId: "replay",
    replay: true,
    settings: normalizeAISalesAgentSettings(settings.aiSalesAgent),
  };

  console.log(
    `Conversation ${String(conversation._id)} (session ${conversation.sessionId ?? "?"}, ${conversation.locale ?? "?"}), started ${conversation.createdAt ? new Date(conversation.createdAt).toISOString() : "?"}`,
  );
  console.log("");

  const timeline: TimelineEntry[] = [
    ...(conversation.messages || []).map((message): TimelineEntry => ({
      at: message.createdAt ? new Date(message.createdAt).getTime() : 0,
      kind: "message",
      message,
    })),
    ...(conversation.actions || []).map((action): TimelineEntry => ({
      at: action.createdAt ? new Date(action.createdAt).getTime() : 0,
      kind: "action",
      action,
    })),
  ].sort((a, b) => a.at - b.at);

  let searches = 0;
  let changed = 0;
  for (const entry of timeline) {
    if (entry.kind === "message") {
      const { message } = entry;
      console.log(`${time(message.createdAt)}  ${(message.role || "?").padEnd(9)} ${oneLine(message.content)}`);
      continue;
    }

    const { action } = entry;
    if (action.name !== "search_products") {
      console.log(
        `${time(action.createdAt)}  ${"tool".padEnd(9)} ${action.name ?? action.type ?? "?"}: ${oneLine(action.payload?.content ?? "", 100)}`,
      );
      continue;
    }

    const saved = parseSavedSearch(action.payload);
    if (!saved) {
      console.log(`${time(action.createdAt)}  ${"search".padEnd(9)} (unreadable payload) ${oneLine(action.payload?.content ?? "", 100)}`);
      continue;
    }

    searches += 1;
    const args: Record<string, unknown> = {};
    if (saved.query) args.query = saved.query;
    if (saved.category?.requested) args.category = saved.category.requested;
    if (typeof saved.budget?.minPrice === "number") args.minPrice = saved.budget.minPrice;
    if (typeof saved.budget?.maxPrice === "number") args.maxPrice = saved.budget.maxPrice;
    const budgetUnknown = !saved.budget && !("budget" in saved);

    console.log(`${time(action.createdAt)}  ${"search".padEnd(9)} ${JSON.stringify(args)}${budgetUnknown ? "  (price limits were not recorded before 2.2)" : ""}`);
    console.log(`${"".padEnd(10)} then: ${describeVerdict(saved)}`);

    const now = parseSavedSearch({
      content: (await aiSalesToolHandlers.search_products(args, ctx)).content,
    });
    if (!now) {
      console.log(`${"".padEnd(10)} now:  (unreadable answer)`);
      continue;
    }
    const differs = describeVerdict(now) !== describeVerdict(saved);
    if (differs) changed += 1;
    console.log(`${"".padEnd(10)} now:  ${describeVerdict(now)}${differs ? "   ← changed" : ""}`);
  }

  console.log("");
  console.log(
    searches === 0
      ? "No searches in this conversation."
      : `${searches} search${searches === 1 ? "" : "es"} replayed, ${changed} answered differently today.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
