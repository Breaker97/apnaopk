"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DataTableAction } from "./types";

interface DataTableRowActionsProps {
  actions: DataTableAction[];
  variant?: "dropdown" | "inline" | "inline-soft" | "split";
}

export function DataTableRowActions({
  actions,
  variant = "dropdown",
}: DataTableRowActionsProps) {
  if (actions.length === 0) return null;

  const renderInlineAction = (
    action: DataTableAction,
    className: string,
  ) => {
    const resolvedClassName = cn(
      className,
      action.variant === "destructive" &&
        "hover:bg-destructive/10 hover:text-destructive",
      action.disabled && "pointer-events-none opacity-40",
      action.className,
    );

    if (action.href) {
      return (
        <Link
          href={action.href}
          className={resolvedClassName}
          aria-disabled={action.disabled}
          tabIndex={action.disabled ? -1 : undefined}
          title={action.label}
        >
          {action.icon}
          <span className="sr-only">{action.label}</span>
        </Link>
      );
    }

    return (
      <button
        type="button"
        className={resolvedClassName}
        onClick={action.onClick}
        disabled={action.disabled}
        title={action.label}
      >
        {action.icon}
        <span className="sr-only">{action.label}</span>
      </button>
    );
  };

  if (variant === "inline") {
    return (
      <div className="inline-flex cursor-default items-stretch overflow-hidden rounded-sm border border-border bg-background">
        {actions.map((action, index) => {
          return (
            <span key={action.id} className="flex items-stretch">
              {index > 0 && <span className="w-px bg-border" />}
              {renderInlineAction(
                action,
                cn(
                  "flex h-8 w-8 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                ),
              )}
            </span>
          );
        })}
      </div>
    );
  }

  if (variant === "inline-soft") {
    return (
      <div className="inline-flex cursor-default items-stretch overflow-hidden rounded-xl border border-border bg-muted/40">
        {actions.map((action, index) => {
          return (
            <span key={action.id} className="flex items-stretch">
              {index > 0 && <span className="w-px bg-border/80" />}
              {renderInlineAction(
                action,
                "flex h-8 w-8 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
              )}
            </span>
          );
        })}
      </div>
    );
  }

  if (variant === "split") {
    const [primaryAction, ...menuActions] = actions;
    if (!primaryAction) return null;

    const primaryClassName = cn(
      "inline-flex h-8 min-w-[54px] items-center justify-center px-3 text-[13px] font-medium text-slate-900 transition-colors hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 dark:text-slate-50 dark:hover:bg-slate-800/70",
      primaryAction.disabled && "pointer-events-none opacity-50",
      primaryAction.className,
    );

    const primary = primaryAction.href ? (
      <Link
        href={primaryAction.href}
        className={primaryClassName}
        aria-disabled={primaryAction.disabled}
        tabIndex={primaryAction.disabled ? -1 : undefined}
      >
        {primaryAction.label}
      </Link>
    ) : (
      <button
        type="button"
        className={primaryClassName}
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
      >
        {primaryAction.label}
      </button>
    );

    const normalActions = menuActions.filter(
      (action) => action.variant !== "destructive",
    );
    const destructiveActions = menuActions.filter(
      (action) => action.variant === "destructive",
    );

    return (
      <div className="inline-flex h-8 items-stretch overflow-hidden rounded-[7px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700 dark:bg-slate-950">
        {primary}
        {menuActions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-900 transition-colors hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 dark:border-slate-700 dark:text-slate-50 dark:hover:bg-slate-800/70"
              >
                <MoreVertical className="h-4 w-4" strokeWidth={2.25} />
                <span className="sr-only">Open menu</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-[98px] min-w-[98px] rounded-[9px] border-slate-200 bg-white p-1 shadow-[0_18px_34px_rgba(15,23,42,0.16)] dark:border-slate-700 dark:bg-slate-950"
            >
              {normalActions.map((action) =>
                action.href ? (
                  <DropdownMenuItem
                    key={action.id}
                    asChild
                    disabled={action.disabled}
                    className="h-8 rounded-[5px] px-3 text-[13px] font-normal text-slate-900 focus:bg-slate-50 dark:text-slate-50 dark:focus:bg-slate-800"
                  >
                    <Link href={action.href}>{action.label}</Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={action.id}
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className="h-8 rounded-[5px] px-3 text-[13px] font-normal text-slate-900 focus:bg-slate-50 dark:text-slate-50 dark:focus:bg-slate-800"
                  >
                    {action.label}
                  </DropdownMenuItem>
                ),
              )}

              {normalActions.length > 0 && destructiveActions.length > 0 && (
                <DropdownMenuSeparator className="my-1 bg-slate-200 dark:bg-slate-700" />
              )}

              {destructiveActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="h-8 rounded-[5px] px-3 text-[13px] font-normal text-slate-900 focus:bg-slate-50 focus:text-slate-900 dark:text-slate-50 dark:focus:bg-slate-800 dark:focus:text-slate-50"
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }

  // Default dropdown variant
  const normalActions = actions.filter((a) => a.variant !== "destructive");
  const destructiveActions = actions.filter((a) => a.variant === "destructive");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-[8px] bg-background"
        >
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {normalActions.map((action) =>
          action.href ? (
            <DropdownMenuItem
              key={action.id}
              asChild
              disabled={action.disabled}
            >
              <Link href={action.href} className="flex items-center">
                {action.icon}
                <span className={action.icon ? "ml-2" : ""}>
                  {action.label}
                </span>
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={action.id}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.icon}
              <span className={action.icon ? "ml-2" : ""}>{action.label}</span>
            </DropdownMenuItem>
          ),
        )}

        {normalActions.length > 0 && destructiveActions.length > 0 && (
          <DropdownMenuSeparator />
        )}

        {destructiveActions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            onClick={action.onClick}
            disabled={action.disabled}
            className="text-destructive focus:text-destructive"
          >
            {action.icon}
            <span className={action.icon ? "ml-2" : ""}>{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
