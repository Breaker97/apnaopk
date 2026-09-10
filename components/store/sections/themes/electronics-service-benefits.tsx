import {
  BadgePercent,
  Gift,
  Headphones,
  RotateCcw,
  ShieldCheck,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ServiceBenefitItem } from "@/components/store/sections/service-benefits";

const ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  shield: ShieldCheck,
  returns: RotateCcw,
  support: Headphones,
  wallet: Wallet,
  discount: BadgePercent,
  gift: Gift,
};

/**
 * Electronics' take on the service-benefits contract: the perks strip as a
 * sharp spec bar — square corners, dividers, uppercase mono-flavored labels.
 * Same blocks, same data, harder edges.
 */
export function ElectronicsServiceBenefits({
  items,
}: {
  items: ServiceBenefitItem[];
}) {
  const visible = items.filter((item) => item.title || item.text);
  if (visible.length === 0) return null;

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-none border border-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {visible.map((item) => {
            const Icon = ICONS[item.icon] ?? Truck;
            return (
              <div key={item.id} className="flex items-center gap-3 bg-card p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center border border-border text-foreground">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  {item.title ? (
                    <span className="block truncate font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
                      {item.title}
                    </span>
                  ) : null}
                  {item.text ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.text}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
