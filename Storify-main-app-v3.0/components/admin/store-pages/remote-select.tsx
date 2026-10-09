"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";

/** One choice of a server-fed picker: the stored id and what it reads as. */
export interface RemoteOption {
  value: string;
  label: string;
  /** Why this choice needs attention once picked (switched off, …). */
  issue?: string;
}

/**
 * What a stored pick is, when the list in hand does not carry it: its label,
 * and why it needs attention (deleted, switched off, …) — or null when it no
 * longer exists at all.
 */
export interface ResolvedPick {
  label: string;
  issue?: string;
}

/** How long typing has to pause before the server is asked. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Search-then-pick over a list kept on the server — categories, brands,
 * collections — through the app's one select-with-search
 * (components/ui/searchable-select.tsx). The first page shows when it opens;
 * typing asks the server for matches (`load(query)`, debounced), and closing
 * it goes back to the first page.
 *
 * The stored pick always shows under its own name, even when no page carries
 * it (`resolve`), and a pick the storefront can no longer use — deleted,
 * switched off, unpublished — is called out under the control, so a merchant
 * sees why a section went quiet instead of a raw id or a blank box.
 */
export function RemoteSelect({
  value,
  onChange,
  load,
  resolve,
  placeholder,
  searchPlaceholder,
  emptyText,
  searchingText,
  missingLabel,
  missingIssue,
  ariaLabel,
  modal = false,
  className,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The options for what is typed ("" for the first page). */
  load: (query: string) => Promise<RemoteOption[]>;
  /** The stored pick's own label, when the loaded options lack it. */
  resolve: (value: string) => Promise<ResolvedPick | null>;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  searchingText: string;
  /** What the trigger reads for a pick that no longer exists. */
  missingLabel: string;
  /** Why that pick needs attention. */
  missingIssue: string;
  ariaLabel?: string;
  /** Inside a Dialog (see SearchableSelect). */
  modal?: boolean;
  className?: string;
  /**
   * Offer to clear the pick, under this label, at the top of the list while
   * something is picked.
   */
  clearLabel?: string;
}) {
  const [options, setOptions] = useState<RemoteOption[] | null>(null);
  const [firstPage, setFirstPage] = useState<RemoteOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [resolved, setResolved] = useState<Record<string, ResolvedPick | null>>({});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQuery = useRef("");
  // The loaders are props, often new closures every render; the effects
  // below run once per need, so they read the latest through refs.
  const loadRef = useRef(load);
  const resolveRef = useRef(resolve);
  useEffect(() => {
    loadRef.current = load;
    resolveRef.current = resolve;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef
      .current("")
      .then((list) => {
        if (cancelled) return;
        setFirstPage(list);
        setOptions(list);
      })
      .catch(() => {
        if (cancelled) return;
        setFirstPage([]);
        setOptions([]);
      });
    return () => {
      cancelled = true;
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  // A stored pick the first page does not carry is looked up on its own —
  // once per id — so the trigger names it, or says it is gone.
  const known = Boolean(value && firstPage?.some((option) => option.value === value));
  const needsLookup = Boolean(value) && firstPage !== null && !known && !(value in resolved);
  useEffect(() => {
    if (!needsLookup) return;
    let cancelled = false;
    resolveRef
      .current(value)
      .catch(() => null)
      .then((pick) => {
        if (!cancelled) setResolved((current) => ({ ...current, [value]: pick }));
      });
    return () => {
      cancelled = true;
    };
  }, [needsLookup, value]);

  const onSearch = (query: string) => {
    latestQuery.current = query;
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setSearching(false);
      setOptions(firstPage);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(() => {
      loadRef
        .current(trimmed)
        .catch(() => [] as RemoteOption[])
        .then((list) => {
          // An answer to an older query is dropped: the box moved on.
          if (latestQuery.current !== query) return;
          setOptions(list);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
  };

  const pick = value ? resolved[value] : undefined;
  const missing = Boolean(value) && value in resolved && pick === null;
  const knownOption = known ? firstPage?.find((option) => option.value === value) : undefined;
  const issue = missing ? missingIssue : (knownOption?.issue ?? pick?.issue);

  // The trigger reads the selected option's label, so the stored pick rides
  // along at the top whenever the shown list lacks it.
  const shown = options ?? [];
  const selectedOption: RemoteOption | null =
    value && !shown.some((option) => option.value === value)
      ? knownOption
        ? { value, label: knownOption.label }
        : pick
          ? { value, label: pick.label }
          : missing
            ? { value, label: missingLabel }
            : null
      : null;

  return (
    <div className="min-w-0 space-y-1">
      <SearchableSelect
        options={[
          ...(value && clearLabel ? [{ value: "", label: clearLabel }] : []),
          ...(selectedOption ? [selectedOption, ...shown] : shown).map(
            ({ value: optionValue, label }) => ({ value: optionValue, label }),
          ),
        ]}
        value={value}
        onValueChange={onChange}
        onSearch={onSearch}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyText={searching || options === null ? searchingText : emptyText}
        disabled={options === null && !value}
        ariaLabel={ariaLabel}
        modal={modal}
        className={className}
      />
      {issue ? (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{issue}</span>
        </p>
      ) : null}
    </div>
  );
}
