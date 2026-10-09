"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";

/**
 * The setup checklists the admin shows under a form: the Meta channels
 * (Settings → Omnichannel Messaging), storage providers and the mail server
 * (Settings → Email). One look for all of them, at the end of the card whose
 * fields the steps fill: a quiet box, a numbered list, the exact values in
 * code, one caution. Open while the thing is not set up, folded once it works.
 *
 * `defaultOpen` is read once. Key the guide on whatever should start the
 * question over (the provider, the connection) to apply a new one.
 */
export function SetupGuide({
  defaultOpen,
  className,
  children,
}: {
  /** The sections open at first, by `value`. */
  defaultOpen?: string[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <Accordion
      type="multiple"
      defaultValue={defaultOpen}
      className={cn("rounded-md border bg-muted/20 px-4", className)}
    >
      {children}
    </Accordion>
  );
}

/** One folding section of a guide: an icon, a title, and what it holds. */
export function SetupGuideSection({
  value,
  icon: Icon,
  title,
  titleClassName,
  children,
}: {
  value: string;
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  titleClassName?: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="hover:no-underline">
        <span className={cn("flex items-center gap-2", titleClassName)}>
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3">{children}</AccordionContent>
    </AccordionItem>
  );
}

export interface SetupGuideStep {
  key: string;
  text: ReactNode;
  /** A value, command or config fragment, shown verbatim under the text. */
  code?: string;
}

/**
 * Numbered steps. With `copy`, each code block gets a copy button: a command
 * is what an admin gets wrong by retyping. Without it the code is a plain
 * block, for values that are read and typed into the form above.
 */
export function SetupGuideSteps({
  steps,
  copy,
}: {
  steps: readonly SetupGuideStep[];
  copy?: { label: string; failed: string };
}) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={step.key} className="flex gap-3">
          <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-medium tabular-nums ring-1 ring-border">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <p>{step.text}</p>
            {step.code ? (
              copy ? (
                <SetupGuideSnippet
                  code={step.code}
                  copyLabel={copy.label}
                  copyFailed={copy.failed}
                />
              ) : (
                <SetupGuideCode>{step.code}</SetupGuideCode>
              )
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A value shown verbatim: a server name, a permission list, an error. */
export function SetupGuideCode({ children }: { children: ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-md bg-background px-2 py-1 font-mono text-[11px] whitespace-pre text-foreground ring-1 ring-border">
      {children}
    </code>
  );
}

/** A command block with a copy button. */
export function SetupGuideSnippet({
  code,
  copyLabel,
  copyFailed,
}: {
  code: string;
  copyLabel: string;
  copyFailed: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(copyFailed);
    }
  };

  return (
    <span className="relative block">
      <span className="block overflow-x-auto rounded-md bg-background py-1.5 pr-9 pl-2.5 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground ring-1 ring-border">
        {code}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copyLabel}
        className="absolute top-1 right-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </span>
  );
}

/** The one thing in a guide that goes wrong unless it is said. */
export function SetupGuideCaution({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      {children}
    </p>
  );
}
