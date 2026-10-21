"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";

/**
 * One status for a team member, in place of the account status and the
 * separate staff-access switch. Paused is the account's "inactive" (no
 * sign-in, back on any time); Suspended its "banned" (no sign-in, no password
 * reset either). A staff member whose access switch is off, from before the
 * two were folded together, reads as Paused.
 */
export type MemberStatusChoice = "active" | "paused" | "suspended";

type AccountStatus = "active" | "inactive" | "banned";

export function memberStatusChoice(status: AccountStatus, isActive = true): MemberStatusChoice {
  if (status === "banned") return "suspended";
  if (status === "inactive" || !isActive) return "paused";
  return "active";
}

/** The fields a choice saves: the account status, with the access switch back on. */
export function statusFieldsFor(choice: MemberStatusChoice): { status: AccountStatus; isActive: true } {
  return {
    status: choice === "suspended" ? "banned" : choice === "paused" ? "inactive" : "active",
    isActive: true,
  };
}

interface MemberStatusControlProps {
  value: MemberStatusChoice;
  onChange: (next: MemberStatusChoice) => void;
  disabled?: boolean;
}

export function MemberStatusControl({ value, onChange, disabled = false }: MemberStatusControlProps) {
  const tr = useAdminPhrase();
  const name = useId();
  const options: { value: MemberStatusChoice; label: string; hint: string }[] = [
    { value: "active", label: tr("Active", "সক্রিয়"), hint: tr("Can sign in and work.", "সাইন ইন করে কাজ করতে পারে।") },
    {
      value: "paused",
      label: tr("Paused", "বিরতিতে"),
      hint: tr("Can't sign in. Turn back on any time.", "সাইন ইন করতে পারবে না। যেকোনো সময় আবার চালু করা যায়।"),
    },
    {
      value: "suspended",
      label: tr("Suspended", "স্থগিত"),
      hint: tr(
        "Can't sign in or reset their password. For someone who left on bad terms.",
        "সাইন ইন বা পাসওয়ার্ড রিসেট করতে পারবে না। খারাপভাবে চলে যাওয়া কারও জন্য।",
      ),
    },
  ];
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={tr("Status", "স্ট্যাটাস")} className="grid grid-cols-3 overflow-hidden rounded-lg border">
        {options.map((option, index) => (
          <label
            key={option.value}
            className={cn(
              "relative cursor-pointer px-2 py-2 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset",
              index > 0 && "border-l",
              value === option.value ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted/60",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{current.hint}</p>
    </div>
  );
}
