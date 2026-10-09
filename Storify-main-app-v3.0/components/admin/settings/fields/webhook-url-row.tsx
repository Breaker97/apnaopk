"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A read-only URL an operator copies into a provider's own dashboard (a
 * carrier's or a payment gateway's webhook settings). Focusing it selects the
 * whole value.
 */
export function WebhookUrlRow(props: {
  label: string;
  url: string;
  helperText?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{props.label}</Label>
      <Input readOnly value={props.url} onFocus={(e) => e.currentTarget.select()} />
      {props.helperText ? (
        <p className="text-xs text-muted-foreground">{props.helperText}</p>
      ) : null}
    </div>
  );
}
