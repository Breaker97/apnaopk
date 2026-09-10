"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import {
  THEME_PREVIEW_MESSAGE,
  THEME_PREVIEW_READY_MESSAGE,
  type ThemePreviewMessage,
} from "@/lib/storefront/themes/preview-message";
import type { ThemeTokens } from "@/lib/storefront/themes/tokens";
import { cn } from "@/lib/utils";

/** CSS px the frame lays out at before scaling. */
const DEVICE_WIDTHS = { desktop: 1280, mobile: 390 } as const;

/** Storefront pages the switcher offers — where buttons, inputs, cards
 * and badges live, so a token can be seen where it applies. */
const PREVIEW_PAGES = [
  { key: "home", path: "", label: "Home" },
  { key: "products", path: "/products", label: "Products" },
  { key: "cart", path: "/cart", label: "Cart" },
  { key: "search", path: "/search", label: "Search" },
] as const;
type PreviewPage = (typeof PREVIEW_PAGES)[number]["key"];

/**
 * The live storefront beside the theme editor. It frames the REAL store —
 * the same components, products and chrome shoppers get — and posts the
 * editor's unsaved tokens into it on every change; the frame's
 * `ThemePreviewBridge` compiles and applies them on the spot. No server
 * round-trip, no save: a color dragged in the editor lands in the preview
 * while the mouse is still down, and Save only makes it permanent.
 *
 * The pane is a few hundred pixels wide, which is a PHONE to a responsive
 * storefront — so the frame renders at a real desktop (or phone) width and
 * is scaled down to fit, the way every theme editor does it.
 */
export function ThemePreviewPane({
  locale,
  tokens,
  tSafe,
  className,
}: {
  locale: string;
  tokens: ThemeTokens;
  tSafe: TSafe;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [page, setPage] = useState<PreviewPage>("home");
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Counts the frame's "ready" announcements rather than the iframe's load
  // event: in development the storefront hydrates well after `load`, and a
  // payload posted before its bridge listens is simply lost. Each ready
  // (initial, or after the frame navigated) re-sends the current tokens.
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string } | null;
      if (data?.type !== THEME_PREVIEW_READY_MESSAGE) return;
      setReady((count) => count + 1);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Serialized so the effect keys on CONTENT, not on the object identity
  // the editor hands us on every keystroke.
  const payload = JSON.stringify(tokens);

  useEffect(() => {
    if (ready === 0) return;
    const target = frame.current?.contentWindow;
    if (!target) return;
    // Coalesce a burst of color-picker events into one paint.
    const timer = window.setTimeout(() => {
      const message: ThemePreviewMessage = {
        type: THEME_PREVIEW_MESSAGE,
        tokens: JSON.parse(payload) as ThemeTokens,
      };
      target.postMessage(message, window.location.origin);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [ready, payload]);

  const frameWidth = DEVICE_WIDTHS[device];
  const scale = size.width > 0 ? Math.min(1, size.width / frameWidth) : 1;
  const pagePath = PREVIEW_PAGES.find((entry) => entry.key === page)?.path ?? "";
  const src = `/${locale}${pagePath}`;

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border/70 p-0.5">
          {(
            [
              { key: "desktop", icon: Monitor },
              { key: "mobile", icon: Smartphone },
            ] as const
          ).map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={device === key}
              aria-label={tSafe(`admin.themeSettings.preview.${key}`, key)}
              onClick={() => setDevice(key)}
              className={cn(
                "rounded-sm p-1.5 transition-colors",
                device === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <NativeSelect
          value={page}
          onChange={(event) => setPage(event.target.value as PreviewPage)}
          className="h-8 w-auto text-xs"
          aria-label={tSafe("admin.themeSettings.preview.page", "Preview page")}
        >
          {PREVIEW_PAGES.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {tSafe(`admin.themeSettings.preview.pages.${entry.key}`, entry.label)}
            </option>
          ))}
        </NativeSelect>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {tSafe(
            "admin.themeSettings.preview.hint",
            "Live preview — reflects unsaved changes.",
          )}
        </p>
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <Link href={src} target="_blank" rel="noopener">
            {tSafe("admin.themeSettings.preview.open", "Open store")}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <div
        ref={viewport}
        className="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-border/70 bg-muted/30"
      >
        <iframe
          key={src}
          ref={frame}
          title={tSafe("admin.themeSettings.preview.title", "Storefront preview")}
          src={src}
          className="absolute top-0 border-0 bg-background"
          style={{
            width: frameWidth,
            height: size.height > 0 ? size.height / scale : 600,
            // Centre a phone that is narrower than the pane; a scaled desktop
            // fills it edge to edge.
            left: Math.max(0, (size.width - frameWidth * scale) / 2),
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    </div>
  );
}
