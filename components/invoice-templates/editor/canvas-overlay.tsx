"use client";

/**
 * The editor chrome over the rendered pages (§4.1: it never enters the
 * printed DOM): a hit box per element, the selection outline with eight
 * resize handles and a rotate handle, margin and snap guides, and outlines
 * on anything outside the printable area.
 *
 * Everything here is in SCREEN pixels: a page millimetre is 3.7795 px × zoom,
 * so handles keep their size at every zoom while the pages under them are a
 * CSS transform of the 100 % layout. Pointer movement is turned back into
 * page millimetres (`screenToMm`) before anything is written.
 *
 * A drag, resize or rotate is one gesture (`beginGesture` once the pointer
 * has moved 3 px, `previewGesture` per animation frame, `endGesture` on
 * pointer-up), so it is one undo step. A press that never moves is a click:
 * it selects and writes nothing. A press whose design an edit changed before
 * those 3 px never becomes a drag. Alt turns snapping off; Shift keeps the
 * ratio while resizing and turns rotation in 15° steps; Esc cancels.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { isOutOfBounds } from "@/lib/invoice-templates/bounds";
import { printableArea } from "@/lib/invoice-templates/canvas-sizes";
import {
  handleSigns,
  moveBox,
  normalizeDeg,
  resizeBox,
  rotateBy,
  screenToMm,
  unionBounds,
  type Bounds,
  type Box,
  type ResizeHandle,
  RESIZE_HANDLES,
} from "@/lib/invoice-templates/editor/geometry";
import { updateElements } from "@/lib/invoice-templates/editor/operations";
import {
  snapMove,
  snapResize,
  snapTargets,
  snapThresholdMm,
  type SnapGuide,
  type SnapTargets,
} from "@/lib/invoice-templates/editor/snapping";
import type { PaginatedPage, PlacedElement } from "@/lib/invoice-templates/pagination";
import type { TemplateDesign, TemplateElement } from "@/lib/invoice-templates/types";
import { PX_PER_MM } from "@/lib/invoice-templates/units";
import { cn } from "@/lib/utils";
import { useEditor, useEditorApi } from "./editor-store";

/** A page the canvas shows, and where its top sits in the stack (mm at 100 %). */
export type ShownPage = { page: PaginatedPage; topMm: number };

/** How far (screen px) a press must travel before it is a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 3;
/** The smallest hit area an element gets on screen, so a hairline rule can still be grabbed. */
const MIN_HIT_PX = 8;
const HANDLE_PX = 10;
const ROTATE_OFFSET_PX = 24;

type GestureKind = "move" | "resize" | "rotate";

interface Gesture {
  kind: GestureKind;
  pointerId: number;
  start: { x: number; y: number };
  started: boolean;
  base: TemplateDesign;
  /** The elements this gesture changes. */
  ids: string[];
  pageIndex: number;
  targets: SnapTargets;
  /** Move: the moving elements' bounds on this page, where snapping measures from. */
  bounds: Bounds | null;
  handle?: ResizeHandle;
  /** The element as placed on this page (rotate pivots on it; resize snaps from it). */
  placedBox?: Box;
  /** A press on an element of a multi-selection selects only it, unless it turns into a drag. */
  clickSelect: string | null;
  /** Rotate: where the pointer started, in page mm. */
  startPoint?: { xMm: number; yMm: number };
  target: Element | null;
}

const placedBox = (placed: PlacedElement): Box => ({
  xMm: placed.xMm,
  yMm: placed.yMm,
  widthMm: placed.widthMm,
  heightMm: placed.heightMm,
  rotationDeg: placed.element.rotationDeg,
});

/** The resize cursor that matches a handle's direction once the element is rotated. */
const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"] as const;
const HANDLE_ANGLE: Record<ResizeHandle, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
function handleCursor(handle: ResizeHandle, rotationDeg: number): string {
  const angle = (((HANDLE_ANGLE[handle] + rotationDeg) % 180) + 180) % 180;
  return CURSORS[Math.round(angle / 45) % 4]!;
}

/** Where each handle sits on the element's (unrotated) box, as fractions of its size. */
const HANDLE_AT: Record<ResizeHandle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

export interface CanvasOverlayProps {
  pages: ShownPage[];
  zoom: number;
  /** Focus the canvas region, so keyboard shortcuts reach it after a click. */
  onFocusCanvas: () => void;
}

export function CanvasOverlay({ pages, zoom, onFocusCanvas }: CanvasOverlayProps) {
  const t = useTranslations("admin.invoiceTemplates.editor.canvas");
  const api = useEditorApi();
  const design = useEditor((state) => state.design);
  const selection = useEditor((state) => state.selection);
  const [guides, setGuides] = useState<{ pageIndex: number; guides: SnapGuide[] } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef<PointerEvent | null>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const detach = useRef<(() => void) | null>(null);
  const scale = PX_PER_MM * zoom;

  // A gesture never outlives the canvas.
  useEffect(() => () => detach.current?.(), []);

  /** Pointer position in page mm on the gesture's page. */
  const pagePoint = useCallback(
    (event: { clientX: number; clientY: number }, pageIndex: number) => {
      const rect = pageRefs.current[pageIndex]?.getBoundingClientRect();
      const zoomNow = api.getState().zoom;
      return {
        xMm: screenToMm(event.clientX - (rect?.left ?? 0), zoomNow),
        yMm: screenToMm(event.clientY - (rect?.top ?? 0), zoomNow),
      };
    },
    [api],
  );

  const finish = useCallback(
    (outcome: "end" | "cancel") => {
      const g = gesture.current;
      if (!g) return;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      const store = api.getState();
      if (g.started) {
        if (outcome === "end") store.endGesture();
        else store.cancelGesture();
      } else if (outcome === "end" && g.clickSelect) {
        store.select([g.clickSelect]);
      }
      try {
        if (g.target && "releasePointerCapture" in g.target) (g.target as HTMLElement).releasePointerCapture(g.pointerId);
      } catch {
        // Already released (the element re-rendered away).
      }
      gesture.current = null;
      latest.current = null;
      setGuides(null);
      detach.current?.();
      detach.current = null;
    },
    [api],
  );

  const apply = useCallback(
    (event: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dxPx = event.clientX - g.start.x;
      const dyPx = event.clientY - g.start.y;
      const store = api.getState();
      if (!g.started) {
        if (Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX || g.ids.length === 0) return;
        // A key pressed before the 3 px (Delete, Ctrl+Z) changed the design under
        // the press; dragging the pressed-on copy would put that edit back, so the
        // press is dropped instead.
        if (!store.beginGesture(g.base)) {
          finish("cancel");
          return;
        }
        g.started = true;
      }
      const zoomNow = store.zoom;
      const dx = screenToMm(dxPx, zoomNow);
      const dy = screenToMm(dyPx, zoomNow);
      const snapping = !event.altKey;
      const options = { targets: g.targets, thresholdMm: snapThresholdMm(zoomNow), gridMm: g.base.canvas.gridMm };
      let next: TemplateDesign = g.base;
      let shown: SnapGuide[] = [];

      if (g.kind === "move") {
        let move = { dxMm: dx, dyMm: dy };
        if (snapping && g.bounds) {
          const snapped = snapMove(g.bounds, dx, dy, options);
          move = snapped;
          shown = snapped.guides;
        }
        next = updateElements(g.base, g.ids, (element) => moveBox(element, move.dxMm, move.dyMm) as TemplateElement);
      } else if (g.kind === "resize" && g.handle && g.placedBox) {
        const id = g.ids[0]!;
        const original = g.base.elements.find((element) => element.id === id)!;
        // Resize the box as it sits on this page (a roll may have pushed it down), then carry the change back.
        let box = resizeBox(g.placedBox, g.handle, dx, dy, { keepRatio: event.shiftKey });
        if (snapping && !event.shiftKey && !g.placedBox.rotationDeg) {
          const snapped = snapResize(box, handleSigns(g.handle), options);
          box = snapped.box;
          shown = snapped.guides;
        }
        const shiftX = original.xMm - g.placedBox.xMm;
        const shiftY = original.yMm - g.placedBox.yMm;
        next = updateElements(g.base, [id], (element) => ({
          ...element,
          xMm: Math.round((box.xMm + shiftX) * 10) / 10,
          yMm: Math.round((box.yMm + shiftY) * 10) / 10,
          widthMm: box.widthMm,
          heightMm: box.heightMm,
        }));
      } else if (g.kind === "rotate" && g.placedBox && g.startPoint) {
        const id = g.ids[0]!;
        const original = g.base.elements.find((element) => element.id === id)!;
        const deg = rotateBy(g.placedBox, original.rotationDeg, g.startPoint, pagePoint(event, g.pageIndex), event.shiftKey);
        next = updateElements(g.base, [id], (element) => (element.rotationDeg === deg ? element : { ...element, rotationDeg: deg }));
      }
      store.previewGesture(next);
      setGuides(shown.length ? { pageIndex: g.pageIndex, guides: shown } : null);
    },
    [api, finish, pagePoint],
  );

  /** Starts listening for the rest of a gesture on the window, so it survives re-renders under the pointer. */
  const attach = useCallback(
    (event: ReactPointerEvent) => {
      const target = event.currentTarget;
      try {
        (target as HTMLElement).setPointerCapture?.(event.pointerId);
      } catch {
        // jsdom and old browsers: the window listeners below still follow the pointer.
      }
      const onMove = (moveEvent: PointerEvent) => {
        if (!gesture.current || moveEvent.pointerId !== gesture.current.pointerId) return;
        latest.current = moveEvent;
        if (frame.current === null) {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (latest.current) apply(latest.current);
          });
        }
      };
      const onUp = (upEvent: PointerEvent) => {
        if (!gesture.current || upEvent.pointerId !== gesture.current.pointerId) return;
        apply(upEvent);
        finish("end");
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (!gesture.current || cancelEvent.pointerId !== gesture.current.pointerId) return;
        finish("cancel");
      };
      const onKey = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape" || !gesture.current) return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finish("cancel");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
      };
      return target;
    },
    [apply, finish],
  );

  const othersOnPage = (pageIndex: number, exclude: readonly string[]) =>
    (pages[pageIndex]?.page.elements ?? []).filter((placed) => !exclude.includes(placed.element.id)).map(placedBox);

  /** A press on an element: select it (Shift adds or removes) and get ready to move the selection. */
  const startMove = (event: ReactPointerEvent, placed: PlacedElement, pageIndex: number) => {
    if (event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    onFocusCanvas();
    const store = api.getState();
    const id = placed.element.id;
    if (event.shiftKey) {
      store.toggleSelected(id);
      return;
    }
    let selected = store.selection;
    let clickSelect: string | null = null;
    if (!selected.includes(id)) {
      store.select([id]);
      selected = [id];
    } else if (selected.length > 1) {
      clickSelect = id;
    }
    const base = store.design;
    const page = pages[pageIndex]!.page;
    // A flowing block's continuation is laid out by the page flow, not by its own box.
    const ids = base.elements
      .filter((element) => selected.includes(element.id) && !element.locked)
      .filter((element) => !(element.id === id && placed.rows?.continuation))
      .map((element) => element.id);
    const movingOnPage = page.elements.filter((each) => ids.includes(each.element.id) && !each.rows?.continuation).map(placedBox);
    const target = attach(event);
    gesture.current = {
      kind: "move",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      started: false,
      base,
      ids,
      pageIndex,
      targets: snapTargets(base.canvas, page.heightMm, othersOnPage(pageIndex, ids)),
      bounds: unionBounds(movingOnPage),
      clickSelect,
      target,
    };
  };

  /** A press on a resize or rotate handle of the one selected element. */
  const startHandle = (event: ReactPointerEvent, placed: PlacedElement, pageIndex: number, handle: ResizeHandle | "rotate") => {
    if (event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    const store = api.getState();
    const page = pages[pageIndex]!.page;
    const box = placedBox(placed);
    const target = attach(event);
    gesture.current = {
      kind: handle === "rotate" ? "rotate" : "resize",
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      started: false,
      base: store.design,
      ids: [placed.element.id],
      pageIndex,
      targets: snapTargets(store.design.canvas, page.heightMm, othersOnPage(pageIndex, [placed.element.id])),
      bounds: null,
      handle: handle === "rotate" ? undefined : handle,
      placedBox: box,
      startPoint: handle === "rotate" ? pagePoint(event, pageIndex) : undefined,
      clickSelect: null,
      target,
    };
  };

  /** Arrow keys on a focused handle: resize by 1 mm (Shift: 10), or rotate by 1° (Shift: 15°). One step per burst. */
  const keyHandle = (event: ReactKeyboardEvent, element: TemplateElement, handle: ResizeHandle | "rotate") => {
    const deltas: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const store = api.getState();
    if (handle === "rotate") {
      const step = (event.shiftKey ? 15 : 1) * (delta[0] + delta[1]);
      store.updateElement(element.id, { rotationDeg: normalizeDeg(element.rotationDeg + step) }, { group: `rotate-key:${element.id}` });
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const box = resizeBox(element, handle, delta[0] * step, delta[1] * step);
    store.updateElement(
      element.id,
      { xMm: box.xMm, yMm: box.yMm, widthMm: box.widthMm, heightMm: box.heightMm },
      { group: `resize-key:${element.id}:${handle}` },
    );
  };

  const boxStyle = (box: Box, minimum = 0): CSSProperties => {
    const width = box.widthMm * scale;
    const height = box.heightMm * scale;
    const padX = Math.max(0, (minimum - width) / 2);
    const padY = Math.max(0, (minimum - height) / 2);
    return {
      left: box.xMm * scale - padX,
      top: box.yMm * scale - padY,
      width: width + 2 * padX,
      height: height + 2 * padY,
      transform: box.rotationDeg ? `rotate(${box.rotationDeg}deg)` : undefined,
      transformOrigin: "center center",
    };
  };

  const single = selection.length === 1 ? selection[0] : null;

  return (
    <div className="absolute inset-0 select-none" data-editor-overlay="">
      {pages.map((shown, pageIndex) => {
        const { page } = shown;
        const area = printableArea({ ...design.canvas, heightMm: page.heightMm });
        const byZ = [...page.elements].sort((a, b) => a.element.zIndex - b.element.zIndex);
        const selectedHere = page.elements.filter((placed) => selection.includes(placed.element.id));
        return (
          <div
            key={page.number}
            ref={(node) => {
              pageRefs.current[pageIndex] = node;
            }}
            className="absolute"
            data-overlay-page={page.number}
            style={{ left: 0, top: shown.topMm * scale, width: page.widthMm * scale, height: page.heightMm * scale }}
          >
            {/* The printable area. */}
            <div
              aria-hidden
              className="pointer-events-none absolute border border-dashed border-sky-400/60"
              style={{ left: area.xMm * scale, top: area.yMm * scale, width: area.widthMm * scale, height: area.heightMm * scale }}
            />
            {pages.length > 1 && (
              <span className="pointer-events-none absolute -top-5 left-0 text-[11px] tabular-nums text-muted-foreground">
                {t("page", { number: page.number, count: page.count })}
              </span>
            )}

            {byZ.map((placed) => {
              const element = placed.element;
              const outside = isOutOfBounds(element, design.canvas);
              return (
                <div
                  key={element.id}
                  aria-hidden
                  data-hit={element.id}
                  data-out-of-bounds={outside ? "true" : undefined}
                  title={outside ? `${element.name} — ${t("outOfBounds")}` : element.name}
                  className={cn(
                    "absolute touch-none",
                    element.locked || placed.rows?.continuation ? "cursor-default" : "cursor-move",
                    "hover:outline hover:outline-1 hover:outline-offset-0 hover:outline-sky-500/70",
                    outside && "outline-dashed outline-2 outline-offset-0 outline-destructive",
                  )}
                  style={boxStyle(placedBox(placed), MIN_HIT_PX)}
                  onPointerDown={(event) => startMove(event, placed, pageIndex)}
                />
              );
            })}

            {selectedHere.map((placed) => {
              const element = placed.element;
              const editable = single === element.id && !element.locked && !placed.rows?.continuation;
              return (
                <div
                  key={`sel-${element.id}`}
                  className="pointer-events-none absolute"
                  data-selected={element.id}
                  style={boxStyle(placedBox(placed))}
                >
                  <div aria-hidden className="absolute -inset-px rounded-[1px] border-2 border-primary" />
                  {element.locked && (
                    <span className="absolute -top-5 left-0 inline-flex items-center gap-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                      <Lock aria-hidden className="h-2.5 w-2.5" />
                      {t("locked")}
                    </span>
                  )}
                  {placed.rows?.continuation && single === element.id && (
                    <span className="absolute -top-5 left-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t("continued")}</span>
                  )}
                  {editable && (
                    <>
                      {RESIZE_HANDLES.map((handle) => {
                        const [fx, fy] = HANDLE_AT[handle];
                        return (
                          <button
                            key={handle}
                            type="button"
                            data-handle={handle}
                            aria-label={t(`handles.${handle}`, { name: element.name })}
                            className="pointer-events-auto absolute touch-none rounded-[2px] border border-primary bg-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                            style={{
                              width: HANDLE_PX,
                              height: HANDLE_PX,
                              left: `calc(${fx * 100}% - ${HANDLE_PX / 2}px)`,
                              top: `calc(${fy * 100}% - ${HANDLE_PX / 2}px)`,
                              cursor: handleCursor(handle, element.rotationDeg),
                            }}
                            onPointerDown={(event) => startHandle(event, placed, pageIndex, handle)}
                            onKeyDown={(event) => keyHandle(event, element, handle)}
                          />
                        );
                      })}
                      <span
                        aria-hidden
                        className="absolute left-1/2 w-px bg-primary"
                        style={{ top: -ROTATE_OFFSET_PX, height: ROTATE_OFFSET_PX - HANDLE_PX / 2 }}
                      />
                      <button
                        type="button"
                        data-handle="rotate"
                        aria-label={t("handles.rotate", { name: element.name })}
                        className="pointer-events-auto absolute touch-none rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                        style={{
                          width: HANDLE_PX + 2,
                          height: HANDLE_PX + 2,
                          left: `calc(50% - ${(HANDLE_PX + 2) / 2}px)`,
                          top: -ROTATE_OFFSET_PX - (HANDLE_PX + 2) / 2,
                          cursor: "grab",
                        }}
                        onPointerDown={(event) => startHandle(event, placed, pageIndex, "rotate")}
                        onKeyDown={(event) => keyHandle(event, element, "rotate")}
                      />
                    </>
                  )}
                </div>
              );
            })}

            {guides?.pageIndex === pageIndex &&
              guides.guides.map((guide, index) => (
                <span
                  key={`${guide.axis}-${guide.mm}-${index}`}
                  aria-hidden
                  data-guide={guide.kind}
                  className={cn("pointer-events-none absolute", guide.kind === "element" ? "bg-fuchsia-500" : "bg-sky-500")}
                  style={
                    guide.axis === "x"
                      ? { left: guide.mm * scale, top: 0, width: 1, height: page.heightMm * scale }
                      : { top: guide.mm * scale, left: 0, height: 1, width: page.widthMm * scale }
                  }
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
