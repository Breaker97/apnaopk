import Image from "next/image";
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

export function StripeLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#635BFF]" className={className} label="Stripe">
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 text-white"
        fill="currentColor"
      >
        <path d="M13.479 9.883c-1.626-.604-2.512-1.067-2.512-1.803 0-.622.511-.978 1.422-.978 1.667 0 3.379.642 4.558 1.22l.666-4.111c-.935-.446-2.847-1.177-5.49-1.177-1.87 0-3.425.489-4.536 1.401-1.155.954-1.757 2.334-1.757 4.005 0 3.027 1.847 4.329 4.866 5.428 1.936.71 2.622 1.187 2.622 1.94 0 .732-.629 1.144-1.802 1.144-1.443 0-3.876-.711-5.503-1.555L4.79 18.55c1.42.804 4.103 1.617 6.892 1.617 1.98 0 3.624-.469 4.736-1.354 1.244-.98 1.89-2.422 1.89-4.355 0-3.085-1.86-4.367-4.829-5.575z" />
      </svg>
    </LogoBadge>
  );
}

export function PayPalLogo({ className }: LogoProps) {
  return (
    <Image
      src="/images/payments/PayPal Double-P Logo on Light Background.png"
      alt="PayPal"
      width={40}
      height={40}
      className={cn("h-10 w-10 shrink-0 object-contain", className)}
    />
  );
}

export function RazorpayLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#0C2451]" className={className} label="Razorpay">
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
      >
        <path
          d="M22.436 0L5.4 6.825 3.633 13.71l9.72-3.948L7.388 23.006h6.04L22.435 0z"
          fill="#3395FF"
        />
        <path
          d="M5.4 6.825L3.633 13.71l9.72-3.948-1.39 5.196 4.65-7.358L5.4 6.825z"
          fill="#fff"
          opacity="0.9"
        />
      </svg>
    </LogoBadge>
  );
}

export function PaystackLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#011B33]" className={className} label="Paystack">
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="#00C3F7"
      >
        <path d="M.224 4.491A1.99 1.99 0 0 1 2.225 2.5h19.55a1.99 1.99 0 0 1 2 1.991V5.5a1 1 0 0 1-1 1H1.224a1 1 0 0 1-1-1V4.49zM.224 9.491A1.99 1.99 0 0 1 2.225 7.5h19.55a1.99 1.99 0 0 1 2 1.991V10.5a1 1 0 0 1-1 1H1.224a1 1 0 0 1-1-1V9.49zM1.224 12.5h13.55a1 1 0 0 1 1 1v1.01a1.99 1.99 0 0 1-2 1.991H2.225a1.99 1.99 0 0 1-2-1.991V13.5a1 1 0 0 1 1-1zM1.224 17.5h7.55a1 1 0 0 1 1 1v1.01a1.99 1.99 0 0 1-2 1.991H2.225a1.99 1.99 0 0 1-2-1.991V18.5a1 1 0 0 1 1-1z" />
      </svg>
    </LogoBadge>
  );
}

export function PesapalLogo({ className }: LogoProps) {
  return (
    <Image
      src="/images/payments/Blue Rounded App Icon with White Letter p.png"
      alt="Pesapal"
      width={40}
      height={40}
      className={cn("h-10 w-10 shrink-0 rounded-lg object-contain", className)}
    />
  );
}

export function IotecLogo({ className }: LogoProps) {
  return (
    <Image
      src="/images/payments/Minimal White Monogram on Blue.png"
      alt="ioTec Pay"
      width={40}
      height={40}
      className={cn("h-10 w-10 shrink-0 rounded-lg object-contain", className)}
    />
  );
}

export function OrangeMoneyLogo({ className }: LogoProps) {
  return (
    <Image
      src="/images/payments/Mirrored White Arrows on Orange.png"
      alt="Orange Money"
      width={40}
      height={40}
      className={cn("h-10 w-10 shrink-0 object-contain", className)}
    />
  );
}

export function MtnMomoLogo({ className }: LogoProps) {
  return (
    <Image
      src="/images/payments/MTN Logo on Vibrant Yellow.png"
      alt="MTN Mobile Money"
      width={40}
      height={40}
      className={cn("h-10 w-10 shrink-0 object-contain", className)}
    />
  );
}

export function TurnstileLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-amber-500" className={className} label="Cloudflare Turnstile">
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </LogoBadge>
  );
}

/** Not a brand, so its name comes from the caller, translated. */
export function CashOnDeliveryLogo({
  className,
  label,
}: LogoProps & { label: string }) {
  return (
    <LogoBadge bg="bg-orange-500" className={className} label={label}>
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
        <circle cx="17" cy="18" r="2" />
        <circle cx="7" cy="18" r="2" />
      </svg>
    </LogoBadge>
  );
}
