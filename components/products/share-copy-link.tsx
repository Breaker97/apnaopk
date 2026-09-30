"use client";

import { useState, type CSSProperties } from "react";
import { Check, Link2 } from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";

/**
 * "Copy link" in the product page's share row — the one control there that
 * answers to a click; the rest are links drawn on the server
 * (product-share-row.tsx). The wording comes translated from the server.
 */
export function ShareCopyLink({
  url,
  label,
  copiedLabel,
  failedLabel,
  className,
  style,
}: {
  url: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(copiedLabel);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(failedLabel);
    }
  };

  const current = copied ? copiedLabel : label;
  const Icon = copied ? Check : Link2;
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={current}
      title={current}
      className={cn(className, copied && "border-green-500 text-green-600")}
      style={style}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
