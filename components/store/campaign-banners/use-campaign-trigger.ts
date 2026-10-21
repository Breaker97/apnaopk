"use client";

import { useEffect, useState } from "react";
import type { CampaignBannerRules } from "@/lib/campaign-banners/types";

/**
 * Whether a banner's trigger has fired: right away, after N seconds on the
 * page, or once the visitor has scrolled N% of it. Goes true once and stays
 * true — a banner does not retract because the visitor scrolled back up.
 * `enabled` false (nothing chosen to show) fires nothing.
 */
export function useCampaignTrigger(
  trigger: CampaignBannerRules["trigger"] | null,
): boolean {
  const [fired, setFired] = useState(false);
  const kind = trigger?.kind;
  const seconds = trigger?.seconds ?? 0;
  const percent = trigger?.percent ?? 0;

  useEffect(() => {
    if (!kind) return;

    if (kind === "immediate") {
      const frame = requestAnimationFrame(() => setFired(true));
      return () => cancelAnimationFrame(frame);
    }
    if (kind === "delay") {
      const timer = setTimeout(() => setFired(true), seconds * 1000);
      return () => clearTimeout(timer);
    }

    const check = () => {
      const root = document.documentElement;
      const scrollable = root.scrollHeight - window.innerHeight;
      // A page too short to scroll has been "scrolled" all the way already.
      const scrolled =
        scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
      if (scrolled >= percent) setFired(true);
    };
    window.addEventListener("scroll", check, { passive: true });
    check();
    return () => window.removeEventListener("scroll", check);
  }, [kind, seconds, percent]);

  return fired;
}
