"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the sales assistant. The store layout mounts it only when
 * the assistant is on, but a component the layout imports directly is in every
 * storefront page's first-load JavaScript whether it renders or not. Through
 * here, a store with the assistant off never downloads it, and one with it on
 * gets the chunk preloaded with the page. See product-details-lazy.tsx for why
 * the boundary is a client wrapper.
 */
const AISalesAgentWidget = dynamic(() =>
  import("@/components/ai-sales-agent/ai-sales-agent-widget").then(
    (module) => module.AISalesAgentWidget,
  ),
);

export function AISalesAgentWidgetLazy(
  props: ComponentProps<typeof AISalesAgentWidget>,
) {
  return <AISalesAgentWidget {...props} />;
}
