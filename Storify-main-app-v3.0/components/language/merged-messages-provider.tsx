"use client";

import { useMemo, type ReactNode } from "react";
import {
  NextIntlClientProvider,
  useLocale,
  useMessages,
  type AbstractIntlMessages,
} from "next-intl";

/**
 * The provider above's messages with `messages` merged in, for the client
 * components under it. A nested provider otherwise replaces its parent's
 * messages, so a page adding a few strings would send the whole bundle again —
 * and on a client-side navigation, where the layouts' copy is not in the
 * payload, all of it. Formats, time zone and error handling carry over from
 * the provider above.
 */
export function MergedMessagesProvider({
  messages,
  children,
}: {
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  const locale = useLocale();
  const parent = useMessages() as AbstractIntlMessages;
  const merged = useMemo(() => mergeMessages(parent, messages), [parent, messages]);

  return (
    <NextIntlClientProvider locale={locale} messages={merged}>
      {children}
    </NextIntlClientProvider>
  );
}

function mergeMessages(
  base: AbstractIntlMessages,
  extra: AbstractIntlMessages,
): AbstractIntlMessages {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = merged[key];
    merged[key] =
      isMessageTree(current) && isMessageTree(value)
        ? mergeMessages(current, value)
        : value;
  }
  return merged;
}

function isMessageTree(value: unknown): value is AbstractIntlMessages {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
