"use client";

import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The admin's underline tab bar — the AI Sales Agent page's style, shared:
 * a bottom-bordered row of icon + label triggers where the active tab turns
 * primary and carries the underline, with an optional count badge. Use these
 * inside a regular <Tabs>; page-level admin screens should prefer this over
 * the boxed TabsList look.
 */
export function UnderlineTabsList({
  className,
  children,
  ...props
}: ComponentProps<typeof TabsList>) {
  return (
    <div className="scrollbar-hide -mx-1 flex overflow-x-auto border-b">
      <TabsList
        className={cn(
          "h-auto w-fit min-w-full justify-start gap-1 rounded-none bg-transparent p-0 px-1",
          className,
        )}
        {...props}
      >
        {children}
      </TabsList>
    </div>
  );
}

export function UnderlineTabsTrigger({
  icon: Icon,
  count,
  className,
  children,
  ...props
}: ComponentProps<typeof TabsTrigger> & {
  icon?: LucideIcon;
  /** Optional counter chip after the label (hidden while 0). */
  count?: number;
}) {
  return (
    <TabsTrigger
      className={cn(
        "group/underline-tab -mb-px h-auto flex-none gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-medium shadow-none transition-colors",
        "text-muted-foreground hover:text-foreground",
        "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon className="h-4 w-4 text-muted-foreground transition-colors group-data-[state=active]/underline-tab:text-primary" />
      ) : null}
      {children}
      {count && count > 0 ? (
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-foreground group-data-[state=active]/underline-tab:bg-primary group-data-[state=active]/underline-tab:text-primary-foreground">
          {count}
        </span>
      ) : null}
    </TabsTrigger>
  );
}
