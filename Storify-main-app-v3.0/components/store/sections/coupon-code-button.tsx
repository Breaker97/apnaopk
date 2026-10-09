"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CouponCodeButtonProps {
  code: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
}

/** Dashed coupon chip that copies its code to the clipboard. */
export function CouponCodeButton({
  code,
  copyLabel,
  copiedLabel,
  className,
}: CouponCodeButtonProps) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "h-11 gap-2 rounded-full border-2 border-dashed px-5 font-mono text-sm font-semibold tracking-widest",
        // Full width on a phone, where it is the row rather than one chip in
        // it; the code takes the space and the copy label sits at the far end
        // so the whole pill reads as one tap target.
        "w-full justify-between sm:w-auto sm:justify-center",
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard denied (permissions/insecure context): leave the code
          // visible for manual selection instead of pretending it copied.
        }
      }}
    >
      {/* Merchants write codes of any length; a long one ellipsises rather
          than stretching the pill out through the banner. */}
      <span className="min-w-0 truncate">{code}</span>
      <span className="flex shrink-0 items-center gap-2">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        <span className="font-sans text-xs font-medium normal-case tracking-normal text-muted-foreground">
          {copied ? copiedLabel : copyLabel}
        </span>
      </span>
    </Button>
  );
}
