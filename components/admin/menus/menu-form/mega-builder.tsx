"use client";

import { CustomMegaMenuPanel } from "@/components/layout/store-header/mega-menu";
import type { HeaderMenuItem } from "@/lib/site-config/header-config";
import type { MenuItem } from "@/components/admin/menus/menu-form/helpers";

/**
 * Live preview built from the storefront's own panel component rather than a
 * lookalike, so what a merchant checks here is literally what ships. Hovering a
 * category opens its flyout exactly as it will on the store.
 */
export function MegaMenuPreview({
  items,
  railLabel,
  viewAllLabel,
  viewAllShortLabel,
  emptyLabel,
}: {
  items: MenuItem[];
  railLabel: string;
  viewAllLabel: string;
  viewAllShortLabel: string;
  emptyLabel: string;
}) {
  const roots = toHeaderItems(items).filter((item) => item.label.trim());

  // On its own tab an empty preview is a blank page, so say why it is blank.
  if (roots.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex justify-center overflow-x-auto rounded-xl border bg-muted/40 p-6">
      <div className="min-w-max">
        <CustomMegaMenuPanel
          roots={roots}
          railLabel={railLabel}
          viewAllHref="#"
          viewAllLabel={viewAllLabel}
          viewAllShortLabel={viewAllShortLabel}
          onNavigate={() => {}}
        />
      </div>
    </div>
  );
}

function toHeaderItems(items: MenuItem[]): HeaderMenuItem[] {
  return (items || []).map((item) => ({
    label: item.label,
    // The preview must never navigate away from the unsaved form.
    href: "#",
    target: item.target,
    icon: item.icon,
    image: item.image,
    badge: item.badge,
    isFeatured: item.isFeatured,
    promoMode: item.promoMode,
    promoImages: item.promoImages,
    columnTitle: item.columnTitle,
    children: toHeaderItems(item.children || []),
  }));
}
