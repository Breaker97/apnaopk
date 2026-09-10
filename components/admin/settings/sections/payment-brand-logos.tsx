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
    <LogoBadge bg="bg-[#003087]" className={className} label="PayPal">
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 text-white"
        fill="currentColor"
      >
        <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" />
      </svg>
    </LogoBadge>
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
    <LogoBadge bg="bg-[#0B8F55]" className={className} label="Pesapal">
      <span className="text-lg font-bold text-white">P</span>
    </LogoBadge>
  );
}

export function IotecLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#0F766E]" className={className} label="ioTec Pay">
      <span className="text-lg font-bold text-white">iT</span>
    </LogoBadge>
  );
}

export function OrangeMoneyLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#FF7900]" className={className} label="Orange Money">
      <span className="text-lg font-bold text-white">OM</span>
    </LogoBadge>
  );
}

export function MtnMomoLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-[#FFCC00]" className={className} label="MTN Mobile Money">
      <span className="text-sm font-black text-[#201D12]">MoMo</span>
    </LogoBadge>
  );
}

export function CashOnDeliveryLogo({ className }: LogoProps) {
  return (
    <LogoBadge bg="bg-orange-500" className={className} label="Cash on Delivery">
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
