"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";
import { createScanDetector } from "@/lib/pos/hardware-scanner";

interface UsePOSHardwareScannerOptions {
  /** Off while there is no terminal to scan into, i.e. the register is locked. */
  enabled: boolean;
  /**
   * The product search box. It is the one text field a cashier routinely
   * leaves focus in, so a scan typed into it still counts as a scan.
   */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /**
   * Called once per scan. `inSearch` means the code was typed into the search
   * box and is still there.
   */
  onScan: (code: string, inSearch: boolean) => void;
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Reads a hardware barcode scanner wherever focus is on the POS screen.
 *
 * A scanner types the code and presses Enter, and before this the register
 * only read it through the scan field's own Enter handler. With focus
 * anywhere else, the characters went nowhere and the Enter did whatever the
 * page did with Enter. On the bare page that toggled fullscreen. On the last
 * product tile or cart button clicked, it clicked that again, so the scan
 * silently added the wrong product.
 *
 * Text fields are left to themselves: a note, a cash amount, or the scan
 * field, whose own handler reads the code. The search box is the exception.
 * Elsewhere, every character after the first and the Enter that ends the scan
 * are swallowed, so no button, shortcut or dialog acts on them. The first
 * character cannot yet be told apart from a single keypress, so it passes.
 */
export function usePOSHardwareScanner({
  enabled,
  searchInputRef,
  onScan,
}: UsePOSHardwareScannerOptions) {
  const handleScan = useEffectEvent(onScan);

  useEffect(() => {
    if (!enabled) return;
    const detector = createScanDetector();

    const onKeyDown = (event: KeyboardEvent) => {
      const inSearch =
        searchInputRef.current !== null &&
        event.target === searchInputRef.current;
      if (!inSearch && isTextField(event.target)) {
        detector.reset();
        return;
      }

      const result = detector.push(event);
      if (result.type === "pass") return;

      if (result.type === "burst") {
        // In the search box this is still typing until an Enter proves it a
        // scan, so the characters land there as usual.
        if (!inSearch) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleScan(result.code, inSearch);
    };

    // Capture phase on window runs ahead of every other key handler, including
    // the button the Enter would otherwise activate.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, searchInputRef]);
}
