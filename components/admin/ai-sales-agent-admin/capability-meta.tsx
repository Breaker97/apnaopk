import type { ReactNode } from "react";
import {
  Activity,
  MessagesSquare,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import type { IAISalesAgentSettings } from "@/models/settings.model";

export const CAPABILITY_META: Record<
  keyof IAISalesAgentSettings["capabilities"],
  { labelKey: string; descriptionKey: string; icon: ReactNode }
> = {
  productQA: {
    labelKey: "configuration.capabilityMeta.productQA",
    descriptionKey: "configuration.capabilityMeta.productQADescription",
    icon: <MessagesSquare className="h-4 w-4" />,
  },
  recommendations: {
    labelKey: "configuration.capabilityMeta.recommendations",
    descriptionKey: "configuration.capabilityMeta.recommendationsDescription",
    icon: <Sparkles className="h-4 w-4" />,
  },
  cartActions: {
    labelKey: "configuration.capabilityMeta.cartActions",
    descriptionKey: "configuration.capabilityMeta.cartActionsDescription",
    icon: <Zap className="h-4 w-4" />,
  },
  checkoutHandoff: {
    labelKey: "configuration.capabilityMeta.checkoutHandoff",
    descriptionKey: "configuration.capabilityMeta.checkoutHandoffDescription",
    icon: <Wrench className="h-4 w-4" />,
  },
  orderStatus: {
    labelKey: "configuration.capabilityMeta.orderStatus",
    descriptionKey: "configuration.capabilityMeta.orderStatusDescription",
    icon: <Activity className="h-4 w-4" />,
  },
};
