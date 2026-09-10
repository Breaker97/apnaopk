"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SecretInput(props: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Clear the stored secret.
   *
   * A blank field means "keep what is saved" — it has to, because the field
   * renders empty by design. That left no way to *remove* a credential at all:
   * a Stripe secret or an OAuth client secret entered once stayed in the
   * database for good, and disabling the provider left it sitting there. Where
   * this is supplied, the field grows a Remove action that sends an explicit
   * null the save handler turns into an `$unset`.
   */
  onClear?: () => void;
  secretSet?: boolean;
  /**
   * Non-reversible preview of the saved secret (first 3 + last 2 chars, middle
   * masked). When present and the secret is set, it is shown as the placeholder
   * so an operator can confirm the stored value. The field stays empty — typing
   * replaces the secret, leaving it blank keeps the saved value.
   */
  maskedHint?: string;
  placeholderWhenSet?: string;
  placeholderWhenUnset?: string;
  helperText?: string;
  /**
   * Keep freshly typed text readable instead of dotting it out. Used for
   * account identifiers (publishable keys, client IDs, wallet IDs) — the saved
   * value is still masked, but an operator can proofread what they paste.
   */
  revealTyped?: boolean;
}) {
  const placeholder = props.secretSet
    ? props.maskedHint || props.placeholderWhenSet
    : props.placeholderWhenUnset;

  const canClear = Boolean(props.onClear && props.secretSet);

  return (
    <div className="space-y-2">
      {props.label || canClear ? (
        <div className="flex items-center justify-between gap-2">
          {props.label ? <Label htmlFor={props.id}>{props.label}</Label> : <span />}
          {canClear ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive"
              onClick={props.onClear}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
      <Input
        id={props.id}
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-form-type="other"
        className={cn(
          props.value && !props.revealTyped && "[-webkit-text-security:disc]",
        )}
      />
      {props.helperText ? (
        <p className="text-xs text-muted-foreground">{props.helperText}</p>
      ) : null}
    </div>
  );
}
