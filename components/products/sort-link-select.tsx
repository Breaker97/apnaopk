"use client";

import { useRouter } from "@/hooks/use-locale-navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SortLinkOption {
  value: string;
  label: string;
  /** The page this sort order lives on, in the app's `/${locale}/…` spelling. */
  href: string;
}

/**
 * A sort dropdown whose options are pages: choosing one navigates there.
 *
 * The collection and brand pages used to put an `<a>` inside each item, but
 * the select handles the pointer itself and never lets the anchor see the
 * click — picking a sort order changed the label and nothing else. Keyed on
 * the current value so Back and Forward show the order of the page they land
 * on.
 */
export function SortLinkSelect({
  value,
  placeholder,
  options,
}: {
  value: string;
  placeholder: string;
  options: SortLinkOption[];
}) {
  const router = useRouter();

  return (
    <Select
      key={value}
      defaultValue={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) router.push(option.href);
      }}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
