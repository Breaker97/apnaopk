/**
 * The reply a turn gets when the model is not consulted — the month's
 * token budget is spent, or the model could not be reached. Pure: the
 * engine decides the outcome and supplies the strings; this only puts the
 * sentence together, so tests can pin it without next-intl.
 */

/** Why a turn was answered without the model. */
export type AISalesFallbackReason = "model_unavailable" | "budget_exhausted";

export type FallbackOutcome =
  /** The catalogue search found products; the cards carry the answer. */
  | "found"
  /** The catalogue search found nothing for the customer's words. */
  | "notFound"
  /** Tools already ran this turn but produced nothing to show (an FAQ lookup, an order check). */
  | "unknown";

export type FallbackStrings = "found" | "notFound" | "limited";

/**
 * Words a shopper types around the product, never about it. English only:
 * the model normally does this translation, and without it the other
 * languages lose only their two- and three-letter function words to the
 * length rule below. Deliberately not the engine's stop-word list, which is
 * kept tiny so a typed search never drops a real product word.
 */
const CHAT_WORDS = new Set([
  "do", "does", "did", "have", "has", "any", "some", "want", "need", "looking",
  "look", "show", "find", "get", "buy", "sell", "please", "hello", "hi", "hey",
  "thanks", "thank", "there", "here", "can", "could", "would", "will", "you",
  "your", "me", "my", "we", "our", "they", "them", "what", "which", "where",
  "how", "much", "many", "price", "cost", "under", "below", "over", "above",
  "around", "about", "cheap", "cheapest", "best", "good", "something", "thing",
  "like", "one", "ones", "still", "available", "stock", "carry", "sale",
]);

/**
 * The customer's sentence reduced to the words worth searching. The model
 * would normally write the query; here there is no model, and the engine's
 * ladder — which tries every word alone — would match "do" to "Dolby" and
 * put a soundbar next to the iPhones. Short Latin words and chat words go;
 * if nothing is left, the sentence is searched as it was.
 */
export function fallbackSearchQuery(message: string): string {
  // Marks stay with their letters: a Bengali or Hindi vowel sign is a
  // combining mark, and trimming it as punctuation would cut "আছে" short.
  const words = message
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ""))
    .filter(Boolean);
  const kept = words.filter((word) => {
    const lower = word.toLowerCase();
    if (CHAT_WORDS.has(lower)) return false;
    return !(/^[a-z]+$/.test(lower) && lower.length <= 3);
  });
  return (kept.length > 0 ? kept : words).join(" ");
}

export type FallbackTranslator = (key: FallbackStrings) => string;

/**
 * Outcome line first, then the one-line admission that the assistant is
 * answering from the catalogue only, then whatever the merchant wrote for
 * "talk to a human" — so the customer is never left without a next step.
 */
export function composeFallbackReply(input: {
  outcome: FallbackOutcome;
  escalationMessage?: string;
  t: FallbackTranslator;
}): string {
  const lead =
    input.outcome === "found"
      ? input.t("found")
      : input.outcome === "notFound"
        ? input.t("notFound")
        : "";
  return [lead, input.t("limited"), input.escalationMessage?.trim() ?? ""]
    .filter(Boolean)
    .join(" ");
}
