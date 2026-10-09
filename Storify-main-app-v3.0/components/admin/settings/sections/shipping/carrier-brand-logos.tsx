import { Rocket, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

type LogoProps = { className?: string };

function LogoBadge({
  bg,
  children,
  className,
  label,
}: {
  bg: string;
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        bg,
        className,
      )}
      aria-label={label}
      role="img"
    >
      {children}
    </div>
  );
}

/**
 * Glyph marks rather than the carriers' own wordmarks: reproducing a vendor
 * logo needs their brand licence, and these cards sit in an admin screen where
 * recognition is all that is needed.
 */
export function ShippoLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#1F8CE6]" className={className} label="Shippo">
      <Truck className="h-5 w-5 text-white" />
    </LogoBadge>
  );
}

export function ShiprocketLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#7A2FF3]" className={className} label="Shiprocket">
      <Rocket className="h-5 w-5 text-white" />
    </LogoBadge>
  );
}

