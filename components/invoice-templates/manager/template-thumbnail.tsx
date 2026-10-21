"use client";

/**
 * A card's picture of a template: its first page, drawn by the same renderer
 * as everything else (`thumbnail` mode, sample data), scaled to fit the box.
 * The page is laid out at 100 % and only the CSS transform shrinks it, so a
 * thumbnail wraps text exactly as the print does. The renderer's stylesheet
 * is not repeated per card: the manager mounts it once.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { layoutTemplate, TemplateRenderer } from "@/components/invoice-templates/renderer/template-renderer";
import { sampleContext } from "@/lib/invoice-templates/sample-context";
import type { TemplateCategory, TemplateDesign } from "@/lib/invoice-templates/types";
import { mmToPx } from "@/lib/invoice-templates/units";
import { cn } from "@/lib/utils";
import { PAPER_SHADOW } from "./card-styles";

export interface TemplateThumbnailProps {
  design: TemplateDesign;
  category: TemplateCategory;
  className?: string;
}

export function TemplateThumbnail({ design, category, className }: TemplateThumbnailProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const context = useMemo(() => sampleContext(category, design.locale), [category, design.locale]);
  const page = useMemo(() => layoutTemplate(design, context).pages[0], [design, context]);

  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const read = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageWidth = mmToPx(page?.widthMm ?? design.canvas.widthMm);
  const pageHeight = mmToPx(page?.heightMm ?? design.canvas.heightMm);
  const scale = box.width > 0 && box.height > 0 ? Math.min(box.width / pageWidth, box.height / pageHeight) : 0;

  return (
    <div ref={boxRef} className={cn("relative overflow-hidden", className)} aria-hidden data-thumbnail="">
      {scale > 0 && (
        <div
          className="pointer-events-none absolute select-none"
          style={{
            left: (box.width - pageWidth * scale) / 2,
            top: (box.height - pageHeight * scale) / 2,
            width: pageWidth,
            height: pageHeight,
            overflow: "hidden",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            boxShadow: PAPER_SHADOW,
          }}
        >
          <TemplateRenderer template={design} context={context} mode="thumbnail" withStyles={false} />
        </div>
      )}
    </div>
  );
}
