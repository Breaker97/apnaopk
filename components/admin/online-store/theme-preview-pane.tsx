"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/language/link";
import { ExternalLink, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import {
  THEME_PREVIEW_DASHBOARD_SURFACE,
  THEME_PREVIEW_MESSAGE,
  THEME_PREVIEW_READY_MESSAGE,
  type PreviewKeyColors,
  type ThemePreviewMessage,
} from "@/lib/storefront/themes/preview-message";
import type { KeyColorRole, ThemeTokens } from "@/lib/storefront/themes/tokens";
import { cn } from "@/lib/utils";

/** CSS px the frame lays out at before scaling. */
const DEVICE_WIDTHS = { desktop: 1280, mobile: 390 } as const;

/** Storefront pages the switcher offers — where buttons, inputs, cards
 * and badges live, so a token can be seen where it applies. */
const PREVIEW_PAGES = [
  { key: "home", path: "", label: "Home" },
  // Where sale prices, stars, stock and the buy buttons all sit together;
  // its path is a real product, supplied by the page (see `samplePath`).
  { key: "product", path: "", label: "Product page" },
  { key: "products", path: "/products", label: "Products" },
  { key: "cart", path: "/cart", label: "Cart" },
  // The store searches at /products?search=; the term comes from the sample
  // product (see `searchPath`) so the preview shows real results.
  { key: "search", path: "", label: "Search" },
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
  brand, themeId, previewMode, samplePath, highlight = null, highlightLabel, keyColors,
}: {
  /** The unsaved key colours, which a dashboard page opened in the frame paints itself with. */
  keyColors?: PreviewKeyColors;
  /** A key colour to mark in the frame wherever it paints. */
  highlight?: KeyColorRole | null;
  /** Its name, for the toolbar line that says what is marked. */
  highlightLabel?: string;
  locale: string;
  /** A product a shopper can open, for the "Product page" entry. */
  samplePath?: string;
  brand: import("@/lib/storefront/themes/compile").BrandColors;
  themeId: string;
  previewMode: "light" | "dark";
  tokens: ThemeTokens;
  tSafe: TSafe;
  className?: string;
}) {
  const sequence = useRef(0);
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
  const [outdated,setOutdated] = useState(false);
  const [revision,setRevision] = useState(0);

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
      const data = event.data as { type?: string; protocolVersion?: number; themeId?: string; surface?: string } | null;
      if (data?.type !== THEME_PREVIEW_READY_MESSAGE) return;
      // A dashboard page (reached by a link inside the frame) takes only the
      // key colours, so it is ready whichever theme is being edited.
      if (data.protocolVersion === 2 && data.surface === THEME_PREVIEW_DASHBOARD_SURFACE) {setOutdated(false);setReady((count) => count + 1);return;}
      if (data.protocolVersion !== 2 || data.themeId !== themeId) {setOutdated(true);return;}
      setOutdated(false);
      setReady((count) => count + 1);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [themeId]);

  // Serialized so the effect keys on CONTENT, not on the object identity
  // the editor hands us on every keystroke.
  const payload = JSON.stringify({tokens,brand,previewMode,themeId,highlight,keyColors});

  useEffect(() => {
    if (ready === 0) return;
    const target = frame.current?.contentWindow;
    if (!target) return;
    // Coalesce a burst of color-picker events into one paint.
    const timer = window.setTimeout(() => {
      const message: ThemePreviewMessage = {
        type: THEME_PREVIEW_MESSAGE,
        ...JSON.parse(payload),
        protocolVersion: 2,
        sequence: ++sequence.current,
      };
      target.postMessage(message, window.location.origin);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [ready, payload]);

  const frameWidth = DEVICE_WIDTHS[device];
  const scale = size.width > 0 ? Math.min(1, size.width / frameWidth) : 1;
  // The sample product's first slug word — usually its brand ("dell-pro-15"
  // → "dell") — is a search that returns results.
  const searchTerm = samplePath?.split("/").pop()?.split("-")[0] ?? "";
  const searchPath = searchTerm ? `/products?search=${encodeURIComponent(searchTerm)}` : "";
  const pages = PREVIEW_PAGES.filter(
    (entry) =>
      (entry.key !== "product" || samplePath) && (entry.key !== "search" || searchPath),
  );
  const pagePath =
    page === "product"
      ? (samplePath ?? "")
      : page === "search"
        ? searchPath
        : (PREVIEW_PAGES.find((entry) => entry.key === page)?.path ?? "");
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
          onChange={(event) => {setReady(0);setPage(event.target.value as PreviewPage);}}
          className="h-8 w-auto text-xs"
          aria-label={tSafe("admin.themeSettings.preview.page", "Preview page")}
        >
          {pages.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {tSafe(`admin.themeSettings.preview.pages.${entry.key}`, entry.label)}
            </option>
          ))}
        </NativeSelect>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {outdated ? tSafe("admin.themeEditor.previewOutdated","Refresh preview to load the latest color engine.") : ready === 0 ? tSafe("admin.themeEditor.previewLoading","Connecting live preview…") : highlight && highlightLabel ? tSafe("admin.themeEditor.previewShowing","Marking where {color} is used",{color:highlightLabel}) : tSafe("admin.themeSettings.preview.hint","Live preview — reflects unsaved changes.")}
        </p>
        {outdated ? <Button variant="outline" size="sm" onClick={() => {setReady(0);setRevision(v => v+1);}}>{tSafe("admin.themeEditor.refreshPreview","Refresh preview")}</Button> : null}
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
          key={`${src}:${revision}`}
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
