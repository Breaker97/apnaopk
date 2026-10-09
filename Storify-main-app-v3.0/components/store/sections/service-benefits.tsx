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

/**
 * The icon vocabulary the benefit block's `icon` select offers. Fixed list on
 * purpose: stored data carries a name from this set, never a component or
 * arbitrary import path.
 */
export const SERVICE_BENEFIT_ICONS = [
  "truck",
  "shield",
  "returns",
  "support",
  "wallet",
  "discount",
  "gift",
] as const;

/** Icon name → component; exported so the About page's values strip draws from the same set. */
export const SERVICE_BENEFIT_ICON_COMPONENTS: Record<
  (typeof SERVICE_BENEFIT_ICONS)[number],
  LucideIcon
> = {
  truck: Truck,
  shield: ShieldCheck,
  returns: RotateCcw,
  support: Headphones,
  wallet: Wallet,
  discount: BadgePercent,
  gift: Gift,
};

export interface ServiceBenefitItem {
  id: string;
  icon: string;
  title: string;
  text: string;
}

/** The perks strip: free shipping / secure payment / easy returns columns. */
export function ServiceBenefits({ items }: { items: ServiceBenefitItem[] }) {
  const visible = items.filter((item) => item.title || item.text);
  if (visible.length === 0) return null;

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 gap-3 rounded-md border border-border/70 bg-card p-4 sm:grid-cols-2 sm:gap-4 sm:p-6 lg:grid-cols-4">
          {visible.map((item) => {
            const Icon =
              SERVICE_BENEFIT_ICON_COMPONENTS[
                item.icon as (typeof SERVICE_BENEFIT_ICONS)[number]
              ] ??
              Truck;
            return (
              <div key={item.id} className="flex items-start gap-3 p-2">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 space-y-0.5">
                  {item.title ? (
                    <p className="text-sm font-semibold text-foreground">
                      {item.title}
                    </p>
                  ) : null}
                  {item.text ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {item.text}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
