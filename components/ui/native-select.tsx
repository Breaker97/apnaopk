"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type NativeSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "size"
> & {
  size?: "sm" | "default";
};

function NativeSelect({ className, size = "default", ...props }: NativeSelectProps) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input bg-transparent text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 rounded-md border px-3 py-2",
        size === "sm" ? "h-8" : "h-9",
        className
      )}
      {...props}
    />
  );
}

export { NativeSelect };
