"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional element rendered to the left of the label (e.g. a flag). */
  icon?: React.ReactNode;
  /** Extra text matched by the search box in addition to label/value. */
  keywords?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onValueChange: (value: string) => void;
  /** Id for the trigger, so an outer <Label htmlFor> can point at it. */
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Optional icon rendered on the left of the trigger. */
  icon?: React.ReactNode;
  /** Classes for the trigger button. */
  className?: string;
  /** Classes for the popover content. */
  contentClassName?: string;
  /** Render the selected option's label. Defaults to the option label. */
  renderValue?: (option: SearchableSelectOption) => React.ReactNode;
  /**
   * Custom trigger element. When provided it replaces the default bordered
   * button (e.g. a compact icon-only button in a header). It is wrapped in
   * `PopoverTrigger asChild`, so it must forward props/ref to a single child.
   */
  trigger?: React.ReactNode;
  /** Popover alignment. Defaults to "start". */
  align?: "start" | "center" | "end";
}

/**
 * A select with a built-in search box, built on Popover + a filtered list.
 * Reusable drop-in for long option lists (countries, dial codes, etc.).
 */
export function SearchableSelect({
  options,
  value,
  onValueChange,
  id,
  placeholder = "Select",
  searchPlaceholder = "Search...",
  emptyText = "No results found",
  disabled,
  icon,
  className,
  contentClassName,
  renderValue,
  trigger,
  align = "start",
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listboxId = React.useId();

  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.keywords?.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Reset the search each time the popover closes.
  useApplyOnChange([open], () => {
    if (!open) setQuery("");
  });

  // Keyboard focus (aria-activedescendant) restarts at the top whenever the
  // list changes under it.
  useApplyOnChange([query, open], () => {
    setActiveIndex(0);
  });

  const activeOptionId =
    open && filtered.length > 0
      ? `${listboxId}-option-${Math.min(activeIndex, filtered.length - 1)}`
      : undefined;

  React.useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeOptionId]);

  const selectOption = (option: SearchableSelectOption) => {
    onValueChange(option.value);
    setOpen(false);
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (filtered.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case "Enter": {
        // Select the highlighted option instead of submitting the outer form.
        event.preventDefault();
        const option = filtered[Math.min(activeIndex, filtered.length - 1)];
        if (option) selectOption(option);
        break;
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "border-input dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {icon}
              <span
                className={cn(
                  "line-clamp-1 text-left",
                  !selected && "text-muted-foreground",
                )}
              >
                {selected
                  ? renderValue
                    ? renderValue(selected)
                    : selected.label
                  : placeholder}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-[12rem] p-0",
          contentClassName,
        )}
        onOpenAutoFocus={(e) => {
          // Focus the search input, not the first item.
          e.preventDefault();
        }}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div
          id={listboxId}
          role="listbox"
          className="max-h-60 overflow-y-auto p-1"
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            filtered.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === Math.min(activeIndex, filtered.length - 1);
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => selectOption(option)}
                  onMouseMove={() => setActiveIndex(index)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground",
                    isSelected && "bg-accent/60",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon}
                    <span className="line-clamp-1">{option.label}</span>
                  </span>
                  {isSelected && <Check className="size-4 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
