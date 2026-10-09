"use client";

import { useEffect, useRef } from "react";

/**
 * The human check the checkout shows after a shopper's cards have been refused
 * several times.
 *
 * Rendered only when the server asks for it, so the overwhelming majority of
 * shoppers never see it and the script it loads is never fetched. Cloudflare
 * Turnstile resolves itself without anyone clicking anything in most cases; a
 * shopper only sees a checkbox when it is unsure.
 *
 * A store with no site key renders nothing at all — the velocity pause behind
 * this works on its own, and an empty widget would be a dead end for a shopper
 * who cannot pass a check that was never configured.
 */

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);

  return new Promise((resolve) => {
    const existing = document.getElementById(SCRIPT_ID);
    const onReady = () => resolve(window.turnstile ?? null);
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onReady, { once: true });
    // Cloudflare unreachable: the server treats a missing token as "not
    // configured" rather than a failure, so the shopper is not stranded.
    script.addEventListener("error", () => resolve(null), { once: true });
    document.head.appendChild(script);
  });
}

export function TurnstileCheck({
  siteKey,
  onToken,
  label,
}: {
  siteKey?: string;
  /** Called with a fresh token, and with "" when one expires. */
  onToken: (token: string) => void;
  label: string;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  // Kept in a ref so a new `onToken` identity does not tear the widget down
  // and build it again — which would make the shopper solve it twice. Written
  // in an effect, never during render.
  const emit = useRef(onToken);
  useEffect(() => {
    emit.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !holder.current) return;
    let cancelled = false;

    loadTurnstile().then((api) => {
      if (cancelled || !api || !holder.current || widgetId.current) return;
      widgetId.current = api.render(holder.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: (token) => emit.current(token),
        // A token is good once and for a few minutes. When it lapses the
        // shopper must solve another rather than send a stale one.
        "expired-callback": () => emit.current(""),
        "error-callback": () => emit.current(""),
      });
    });

    return () => {
      cancelled = true;
      const id = widgetId.current;
      widgetId.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div className="rounded-xl border bg-muted/40 p-4">
      <p className="mb-3 text-sm text-muted-foreground">{label}</p>
      <div ref={holder} />
    </div>
  );
}
