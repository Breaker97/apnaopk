"use client";

/**
 * Measures a template for a print that has no preview on screen (Print
 * invoice, Print sticker on an order page): the renderer draws it once,
 * hidden and off-screen at 100 %, after the template fonts have loaded, and
 * the rows and shrink-to-fit sizes it measured go to `printTemplate`, so the
 * paper gets the pages a preview would have shown (Phase 2: without a
 * measure a wrapping row is counted as one line).
 *
 * Without a laid-out DOM nothing is measured; after `timeoutMs` the print
 * goes ahead on estimates. Draws only; never writes anything.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { TemplateRenderer } from "@/components/invoice-templates/renderer/template-renderer";
import type { RenderMeasure } from "@/components/invoice-templates/renderer/types";
import { measureReady, mergeMeasure } from "@/components/invoice-templates/preview/template-preview";
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import { awaitTemplateFonts } from "@/lib/invoice-templates/print";
import type { TemplateDesign } from "@/lib/invoice-templates/types";

/** The attribute the hidden host carries while it measures. */
export const MEASURE_HOST_ATTRIBUTE = "data-invoice-template-measure";

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

export async function measureTemplate(
  design: TemplateDesign,
  context: PrintContext,
  options: { timeoutMs?: number } = {},
): Promise<RenderMeasure | null> {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.setAttribute(MEASURE_HOST_ATTRIBUTE, "");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "absolute", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none" });
  document.body.appendChild(host);
  const root = createRoot(host);

  let measure: RenderMeasure | null = null;
  let onChange: (() => void) | null = null;
  const onMeasure = (next: RenderMeasure) => {
    measure = mergeMeasure(measure, next);
    onChange?.();
  };

  try {
    root.render(createElement(TemplateRenderer, { template: design, context, mode: "screen", onMeasure }));
    await nextFrame();
    // The renderer's own stylesheet declared the faces; load them (Bengali too) before trusting a height.
    await awaitTemplateFonts(document).catch(() => false);
    await nextFrame();
    await nextFrame();
    if (!measureReady(design, context, measure)) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, options.timeoutMs ?? 2500);
        onChange = () => {
          if (!measureReady(design, context, measure)) return;
          clearTimeout(timer);
          resolve();
        };
      });
      // Shrink-to-fit reports in the commit after the rows land.
      await nextFrame();
    }
    return measure;
  } finally {
    onChange = null;
    root.unmount();
    host.remove();
  }
}
