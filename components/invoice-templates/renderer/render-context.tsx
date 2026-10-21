"use client";

/**
 * The renderer's own React context: the render mode and the shrink-to-fit
 * results. Nothing from the editor lives here (§4.1: the renderer is pure).
 *
 * `useShrinkToFit` measures in a layout effect on screen; the result is
 * reported upward so a print (static markup, no effects) can be given the
 * same sizes through `measure.fits`.
 */
import { createContext, useContext, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fitFontSize, type FitResult } from "@/lib/invoice-templates/shrink";
import { effectiveFormat } from "@/lib/invoice-templates/formats";
import type { BindingOptions } from "@/lib/invoice-templates/bindings";
import type { TemplateDesign, TemplateElement } from "@/lib/invoice-templates/types";
import type { RenderMode } from "./types";

export interface RendererState {
  mode: RenderMode;
  /** Shrink-to-fit sizes already known (from an earlier screen render). */
  fits: Record<string, FitResult>;
  reportFit?: (elementId: string, fit: FitResult) => void;
}

const RendererContext = createContext<RendererState>({ mode: "screen", fits: {} });

export const RendererProvider = RendererContext.Provider;

export function useRenderer(): RendererState {
  return useContext(RendererContext);
}

/** The format and language an element prints with. */
export function bindingOptions(element: TemplateElement, design: TemplateDesign): BindingOptions {
  return { format: effectiveFormat(design.format, element.format), locale: design.locale };
}

const fitsIn = (box: HTMLElement) => box.scrollHeight <= box.clientHeight + 0.5 && box.scrollWidth <= box.clientWidth + 0.5;

/**
 * The font size an element's box prints at. With `enabled`, the box (the
 * ref) is measured at 100 % and the text shrunk, down to 6 px, until it
 * fits; `deps` name what can change the text.
 */
export function useShrinkToFit(
  elementId: string,
  enabled: boolean,
  basePx: number,
  deps: readonly unknown[],
): { ref: RefObject<HTMLDivElement | null>; fontSizePx: number; overflow: boolean } {
  const { mode, fits, reportFit } = useRenderer();
  const ref = useRef<HTMLDivElement | null>(null);
  const known = fits[elementId];
  const [fit, setFit] = useState<FitResult | null>(known ?? null);

  useLayoutEffect(() => {
    if (!enabled || mode === "print") return;
    const box = ref.current;
    if (!box || box.clientHeight === 0) return; // no layout (static markup, jsdom)
    // React owns the inline font size (it only rewrites it when the value it renders changes), so put back what was there:
    // blanking it would leave a box that already fits at its base size without any font size at all (the page's 16 px).
    const rendered = box.style.fontSize;
    const result = fitFontSize(basePx, (px) => {
      box.style.fontSize = `${px}px`;
      return fitsIn(box);
    });
    box.style.fontSize = rendered;
    setFit((previous) => (previous && previous.px === result.px && previous.fits === result.fits ? previous : result));
    reportFit?.(elementId, result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, basePx, elementId, reportFit, ...deps]);

  if (!enabled) return { ref, fontSizePx: basePx, overflow: false };
  const current = fit ?? known;
  return { ref, fontSizePx: current ? current.px : basePx, overflow: current ? !current.fits : false };
}
