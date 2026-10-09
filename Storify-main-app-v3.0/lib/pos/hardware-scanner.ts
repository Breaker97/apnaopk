/**
 * Tells a hardware barcode scanner apart from a person at the keyboard.
 *
 * To the browser, a USB or Bluetooth scanner is a keyboard. It types the code
 * a few milliseconds per character and then presses Enter. Speed gives it
 * away: nobody types four characters and Enter averaging under 50 ms a key.
 * So the register can read a scan wherever focus happens to be, not only
 * while its scan field has it.
 */

/** A longer pause ends the burst, and the next key starts a new one. */
const MAX_KEY_GAP_MS = 100;
/**
 * The average time per key a burst must stay under. It is an average rather
 * than a per-key limit because Bluetooth scanners send in packets, so one gap
 * in a fast burst can be long.
 */
const MAX_AVERAGE_KEY_MS = 50;
/** Shorter bursts are left alone. */
const MIN_CODE_LENGTH = 4;

type ScanKeyResult =
  /** Not part of a scan, or not yet provably so. Let the key through. */
  | { type: "pass" }
  /** A character arriving at scanner speed in the middle of a burst. */
  | { type: "burst" }
  /** The Enter that ends a scan, with the code that came before it. */
  | { type: "scan"; code: string };

type ScanKey = Pick<
  KeyboardEvent,
  "key" | "timeStamp" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "isComposing"
>;

const PASS: ScanKeyResult = { type: "pass" };
const BURST: ScanKeyResult = { type: "burst" };

export function createScanDetector() {
  let buffer = "";
  let startedAt = 0;
  let lastKeyAt = 0;

  const reset = () => {
    buffer = "";
  };

  const push = (event: ScanKey): ScanKeyResult => {
    // A scanner holds Shift for capital letters, and that must not break the
    // burst. It sends no other modifier. A held key's auto-repeat, or text
    // mid-composition in an input method, is a person typing.
    if (event.key === "Shift") return PASS;
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.repeat ||
      event.isComposing
    ) {
      reset();
      return PASS;
    }

    const continues =
      buffer !== "" && event.timeStamp - lastKeyAt <= MAX_KEY_GAP_MS;

    if (event.key === "Enter") {
      const code = buffer;
      reset();
      const isScan =
        continues &&
        code.length >= MIN_CODE_LENGTH &&
        (event.timeStamp - startedAt) / code.length <= MAX_AVERAGE_KEY_MS;
      return isScan ? { type: "scan", code } : PASS;
    }

    // Arrows, Tab, function keys: no code contains them.
    if (event.key.length !== 1) {
      reset();
      return PASS;
    }

    if (!continues) {
      // A first character proves nothing yet, so it passes. It may be a
      // person's Space on a button or the "/" that focuses search.
      buffer = event.key;
      startedAt = event.timeStamp;
      lastKeyAt = event.timeStamp;
      return PASS;
    }

    buffer += event.key;
    lastKeyAt = event.timeStamp;
    return (event.timeStamp - startedAt) / (buffer.length - 1) <=
      MAX_AVERAGE_KEY_MS
      ? BURST
      : PASS;
  };

  return { push, reset };
}
