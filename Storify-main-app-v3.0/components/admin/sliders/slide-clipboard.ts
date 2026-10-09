"use client";

import { useCallback, useEffect, useState } from "react";
import {
  normalizeSlides,
  normalizeSlideTemplate,
  slideTemplatePreset,
  type SliderSlide,
  type SlideTemplatePreset,
} from "@/lib/sliders/types";

/**
 * A clipboard for slides and for looks, shared by every slider on the page
 * and across tabs: it lives in localStorage, so a slide copied in one
 * slider pastes into another, or into the same slider tomorrow. What is
 * pasted goes through the slide normalizer, so a stale or edited entry can
 * never carry a value the contract refuses.
 */

const KEY = "storify:slider-clipboard";

interface ClipboardShape {
  slide?: unknown;
  style?: unknown;
  at?: number;
}

function read(): { slide: SliderSlide | null; style: SlideTemplatePreset | null } {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { slide: null, style: null };
    const parsed = JSON.parse(raw) as ClipboardShape;
    const slide = parsed.slide ? (normalizeSlides([parsed.slide])[0] ?? null) : null;
    const style = parsed.style
      ? (normalizeSlideTemplate({ id: "clipboard", name: "clipboard", preset: parsed.style })?.preset ?? null)
      : null;
    return { slide, style };
  } catch {
    return { slide: null, style: null };
  }
}

function write(patch: ClipboardShape) {
  try {
    const current = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as ClipboardShape;
    window.localStorage.setItem(KEY, JSON.stringify({ ...current, ...patch, at: Date.now() }));
    window.dispatchEvent(new Event("storify:slider-clipboard"));
  } catch {
    // Storage full or blocked: the copy simply does not take.
  }
}

export function useSlideClipboard() {
  const [state, setState] = useState<{ slide: SliderSlide | null; style: SlideTemplatePreset | null }>({
    slide: null,
    style: null,
  });

  useEffect(() => {
    const sync = () => setState(read());
    // Off the effect's own tick, so the first read sets no state inside it.
    const timer = setTimeout(sync, 0);
    window.addEventListener("storage", sync);
    window.addEventListener("storify:slider-clipboard", sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", sync);
      window.removeEventListener("storify:slider-clipboard", sync);
    };
  }, []);

  const copySlide = useCallback((slide: SliderSlide) => write({ slide }), []);
  const copyStyle = useCallback((slide: SliderSlide) => write({ style: slideTemplatePreset(slide) }), []);

  return { ...state, copySlide, copyStyle };
}
