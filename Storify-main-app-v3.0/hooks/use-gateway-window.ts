"use client";

import { useCallback, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Lets a dialog step aside while a payment gateway's own window is up.
 *
 * Razorpay Checkout opens as an overlay on the page. A Radix modal dialog left
 * open underneath keeps `pointer-events: none` on <body> and traps focus inside
 * itself, so the payer sees Razorpay's window but every click falls through to
 * the dialog below it and keystrokes are pulled back out of the iframe — the
 * payment can never be finished.
 *
 * Render the dialog with `open={props.open && !gatewayOpen}` and open the
 * gateway through `withGatewayWindow`. The dialog closes before the window
 * opens and comes back, with its state, if the payer closes the window; a
 * completed payment navigates away.
 */
export function useGatewayWindow() {
  const [gatewayOpen, setGatewayOpen] = useState(false);

  const withGatewayWindow = useCallback(
    async <T>(openWindow: () => Promise<T>): Promise<T> => {
      flushSync(() => setGatewayOpen(true));
      await pageReleased();
      try {
        return await openWindow();
      } finally {
        setGatewayOpen(false);
      }
    },
    [],
  );

  return { gatewayOpen, withGatewayWindow };
}

/**
 * Resolves once no modal holds the page. Radix gives <body> its pointer
 * events back when the dialog's layer unmounts, after the close animation;
 * the cap keeps an unrelated stuck lock from blocking the payment forever.
 * A timer, not animation frames: those stop in a background tab.
 */
async function pageReleased(timeoutMs = 1000) {
  const started = Date.now();
  while (
    document.body.style.pointerEvents === "none" &&
    Date.now() - started < timeoutMs
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 16));
  }
}
