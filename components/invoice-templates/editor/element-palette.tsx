"use client";

/**
 * "Add to canvas" (docs/INVOICE_TEMPLATE_BUILDER.md §5.3): Smart blocks and
 * Basic elements. Click an item to add it at the middle of the view, or drag
 * it onto the page to drop it at the pointer; either way the new element is
 * selected. Each item says what it starts as.
 */
import { useId, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Barcode,
  BadgeDollarSign,
  Building2,
  Calculator,
  Image as ImageIcon,
  List,
  MapPin,
  Minus,
  QrCode,
  ReceiptText,
  Rows3,
  SeparatorHorizontal,
  Square,
  StickyNote,
  Table,
  Truck,
  Type,
  type LucideIcon,
} from "lucide-react";
import { PALETTE_DRAG_TYPE, PALETTE_ITEMS, type PaletteGroup, type PaletteItemKey } from "@/lib/invoice-templates/editor/palette";
import { cn } from "@/lib/utils";
import { EDITOR_HINT_CLASS, EDITOR_TITLE_CLASS } from "./editor-styles";

const ICONS: Record<PaletteItemKey, LucideIcon> = {
  businessHeader: Building2,
  customerAddress: MapPin,
  orderSummary: ReceiptText,
  productTable: Table,
  priceSummary: Calculator,
  codBadge: BadgeDollarSign,
  smartBarcode: Barcode,
  smartQr: QrCode,
  deliveryMethod: Truck,
  notes: StickyNote,
  divider: SeparatorHorizontal,
  logo: ImageIcon,
  productRows: Rows3,
  text: Type,
  image: ImageIcon,
  barcode: Barcode,
  qr: QrCode,
  line: Minus,
  box: Square,
  products: List,
};

const GROUPS: PaletteGroup[] = ["smart", "basic"];

export interface ElementPaletteProps {
  onAdd: (key: PaletteItemKey) => void;
  className?: string;
}

export function ElementPalette({ onAdd, className }: ElementPaletteProps) {
  const t = useTranslations("admin.invoiceTemplates.editor.palette");
  // The palette can be drawn twice (the column and the drawer); ids stay unique.
  const uid = useId();

  const onDragStart = (event: DragEvent, key: PaletteItemKey) => {
    event.dataTransfer.setData(PALETTE_DRAG_TYPE, key);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <nav aria-label={t("title")} className={cn("space-y-4 p-3", className)} data-editor-palette="">
      <div>
        <h2 className={EDITOR_TITLE_CLASS}>{t("title")}</h2>
        <p className={cn("mt-1", EDITOR_HINT_CLASS)}>{t("hint")}</p>
      </div>
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`${uid}-${group}`} className="space-y-1">
          <h3 id={`${uid}-${group}`} className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t(group)}
          </h3>
          <ul className="grid grid-cols-1 gap-1">
            {PALETTE_ITEMS.filter((item) => item.group === group).map((item) => {
              const Icon = ICONS[item.key];
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    draggable
                    data-palette-item={item.key}
                    aria-labelledby={`${uid}-item-${item.key}`}
                    aria-describedby={`${uid}-item-${item.key}-hint`}
                    onDragStart={(event) => onDragStart(event, item.key)}
                    onClick={() => onAdd(item.key)}
                    className="group flex w-full cursor-grab items-start gap-2.5 rounded-[8px] border border-transparent px-2 py-1.5 text-start transition-colors hover:border-border hover:bg-accent/50 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground">
                      <Icon aria-hidden className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span id={`${uid}-item-${item.key}`} className="block text-xs font-semibold leading-tight">
                        {t(`items.${item.key}`)}
                      </span>
                      <span id={`${uid}-item-${item.key}-hint`} className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        {t(`descriptions.${item.key}`)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
