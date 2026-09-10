"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductCollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function ProductCollapsibleSection({
  title,
  children,
  defaultOpen = false,
  className,
}: ProductCollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-sm border border-zinc-200 bg-neutral-100 dark:border-zinc-700 dark:bg-zinc-900",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left font-semibold text-zinc-900 transition-colors dark:text-zinc-100"
      >
        <span className="text-base">{title}</span>
        <span className="inline-flex items-center justify-center text-zinc-500 dark:text-zinc-300">
          {isOpen ? (
            <Minus className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </span>
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-in-out",
          isOpen ? "max-h-[1000px] px-4 pb-4" : "max-h-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
