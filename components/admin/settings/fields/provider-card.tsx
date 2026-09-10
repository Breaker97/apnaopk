"use client";

import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * The card every third-party integration is configured in.
 *
 * Lifted out of `payment-settings-tab.tsx`, where it was a private helper, so
 * the shipping carriers read as the same kind of thing a payment gateway is —
 * a toggle, a configured/not-configured badge, a test/live badge, credentials
 * behind the toggle, and a Test connection action.
 */
export function ProviderCard(props: {
  logo: ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  /** Renders the header but disables the switch, with `disabledNote` explaining. */
  disabled?: boolean;
  disabledNote?: ReactNode;
  /**
   * A caution that does not gate the toggle — for a setting that will probably
   * fail at use time but that this screen cannot prove wrong from here.
   */
  note?: ReactNode;
  badges?: ReactNode;
  testButton?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground transition-colors",
        props.enabled && !props.disabled ? "border-border" : "border-dashed",
        props.disabled && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        {props.logo}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{props.title}</h3>
            {props.badges}
          </div>
          <p className="text-xs text-muted-foreground">{props.description}</p>
          {props.disabled && props.disabledNote ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {props.disabledNote}
            </p>
          ) : null}
          {props.note ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {props.note}
            </p>
          ) : null}
        </div>
        <Switch
          checked={props.enabled && !props.disabled}
          onCheckedChange={props.onToggle}
          disabled={props.disabled}
          aria-label={`Enable ${props.title}`}
        />
      </div>
      {props.enabled && !props.disabled && (props.children || props.testButton) && (
        <div className="border-t px-5 py-5 space-y-4">
          {props.children}
          {props.testButton && (
            <div className="flex justify-end pt-1">{props.testButton}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusBadge(props: { configured: boolean }) {
  if (props.configured) {
    return (
      <Badge
        variant="secondary"
        className="gap-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-3 w-3" />
        Configured
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <CircleDashed className="h-3 w-3" />
      Not configured
    </Badge>
  );
}

export function ModeBadge(props: { mode: "test" | "live" | "sandbox" }) {
  if (props.mode === "live") {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
        Live
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400"
    >
      {props.mode === "sandbox" ? "Sandbox" : "Test"}
    </Badge>
  );
}
