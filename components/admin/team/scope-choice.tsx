"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";

interface ScopeChoiceProps {
  /** Only some vendors, locations or regions; false is everywhere. */
  limited: boolean;
  onChange: (limited: boolean) => void;
  disabled?: boolean;
}

/** Where a staff member works: everywhere, or only the vendors and locations picked below. */
export function ScopeChoice({ limited, onChange, disabled = false }: ScopeChoiceProps) {
  const tr = useAdminPhrase();
  const name = useId();
  const options = [
    {
      value: false,
      label: tr("Everywhere", "সবখানে"),
      hint: tr("All vendors and locations, including ones added later", "সব ভেন্ডর আর লোকেশন, পরে যোগ হওয়াগুলোসহ"),
    },
    {
      value: true,
      label: tr("Only these", "শুধু এগুলো"),
      hint: tr("Pick vendors, locations or regions below", "নিচে ভেন্ডর, লোকেশন বা অঞ্চল বেছে নিন"),
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{tr("Where they work", "কোথায় কাজ করে")}</p>
      <div role="radiogroup" aria-label={tr("Where they work", "কোথায় কাজ করে")} className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={String(option.value)}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-sm",
              limited === option.value && "border-primary bg-primary/5",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent/50",
            )}
          >
            <input
              type="radio"
              name={name}
              className="mt-0.5"
              checked={limited === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>
              <span className="block font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
