"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fitStudioArtboard,
  getStudioArtboard,
  type AiStudioSurface,
} from "@/components/ai-authoring/studio-surface";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

/**
 * Canvas view state: zoom/pan, the measured viewport and per-URL natural image
 * dimensions (for fit-to-screen math), and the compare/peek modes. All of it
 * resets when the studio opens — none of it is worth persisting.
 */
export function useStudioViewport({
  open,
  mounted,
  surface,
  currentUrl,
  originalUrl,
  canCompare,
}: {
  open: boolean;
  mounted: boolean;
  surface: AiStudioSurface;
  currentUrl: string | null;
  originalUrl: string | undefined;
  canCompare: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [versionDims, setVersionDims] = useState<
    Record<string, { w: number; h: number }>
  >({});
  const [compare, setCompare] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const [peek, setPeek] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const compareBoxRef = useRef<HTMLDivElement>(null);
  const lastFitUrl = useRef<string | null>(null);
  const panDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const compareDrag = useRef(false);

  // Reset the view each time the studio opens.
  useApplyOnChange([open], () => {
    if (!open) return;
    setCompare(false);
    setComparePos(50);
    setPeek(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setVersionDims({});
  });
  useEffect(() => {
    if (!open) return;
    lastFitUrl.current = null;
  }, [open]);

  // Track the canvas viewport size for fit-to-screen math. `mounted` is a
  // dependency because the portal (and so the ref) only exists after mount.
  useEffect(() => {
    if (!open || !mounted) return;
    const node = viewportRef.current;
    if (!node) return;
    const update = () =>
      setViewport({ w: node.clientWidth, h: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, mounted]);

  // Wheel-to-zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    if (!open || !mounted) return;
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((value) =>
        Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value * factor)),
      );
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [open, mounted]);

  // Default media stays on the existing square artboard. Opt-in surfaces can
  // provide a fixed rectangular artboard without affecting existing callers.
  const fitZoomFor = useCallback(
    (image: { w: number; h: number }) =>
      fitStudioArtboard(getStudioArtboard(surface, image), viewport),
    [surface, viewport],
  );

  // Auto-fit whenever a new version lands on the canvas.
  useEffect(() => {
    if (!open || !currentUrl) return;
    const d = versionDims[currentUrl];
    if (!d || !viewport.w || !viewport.h) return;
    if (lastFitUrl.current === currentUrl) return;
    lastFitUrl.current = currentUrl;
    setZoom(fitZoomFor(d));
    setPan({ x: 0, y: 0 });
  }, [open, currentUrl, versionDims, viewport, fitZoomFor]);

  const recordDims = (url: string | null) => {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (!url) return;
      const w = event.currentTarget.naturalWidth;
      const h = event.currentTarget.naturalHeight;
      if (!w || !h) return;
      setVersionDims((prev) =>
        prev[url]?.w === w && prev[url]?.h === h
          ? prev
          : { ...prev, [url]: { w, h } },
      );
    };
  };

  const dims = currentUrl ? versionDims[currentUrl] : undefined;
  const showCompare = compare && canCompare && !!dims && !!originalUrl;
  const artboard = dims ? getStudioArtboard(surface, dims) : null;
  const fitScale = artboard ? fitStudioArtboard(artboard, viewport) : 1;

  const zoomIn = () => setZoom((value) => Math.min(ZOOM_MAX, value * 1.25));
  const zoomOut = () => setZoom((value) => Math.max(ZOOM_MIN, value / 1.25));
  const fitToScreen = () => {
    if (!dims) return;
    setZoom(fitScale);
    setPan({ x: 0, y: 0 });
  };

  /** Leave compare/peek — called whenever the image on the stage changes. */
  const resetCompare = () => {
    setCompare(false);
    setPeek(false);
  };

  // ---- Canvas interactions -------------------------------------------------

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (showCompare || !dims || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };
  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.panX + (event.clientX - drag.startX),
      y: drag.panY + (event.clientY - drag.startY),
    });
  };
  const onCanvasPointerUp = () => {
    panDrag.current = null;
  };

  const updateComparePos = (clientX: number) => {
    const rect = compareBoxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setComparePos(
      Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100)),
    );
  };
  const onComparePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    compareDrag.current = true;
    updateComparePos(event.clientX);
  };
  const onComparePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (compareDrag.current) updateComparePos(event.clientX);
  };
  const onComparePointerUp = () => {
    compareDrag.current = false;
  };

  return {
    zoom,
    pan,
    viewport,
    dims,
    compare,
    setCompare,
    comparePos,
    peek,
    setPeek,
    showCompare,
    artboard,
    fitScale,
    viewportRef,
    compareBoxRef,
    recordDims,
    zoomIn,
    zoomOut,
    fitToScreen,
    resetCompare,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onComparePointerDown,
    onComparePointerMove,
    onComparePointerUp,
  };
}

export type StudioViewportApi = ReturnType<typeof useStudioViewport>;
