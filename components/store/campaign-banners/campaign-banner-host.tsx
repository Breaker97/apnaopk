"use client";

import { useEffect, useState } from "react";
import {
  pickCampaignBanners,
} from "@/lib/campaign-banners/select";
import type { StorefrontCampaignBanner } from "@/lib/campaign-banners/types";
import {
  markCampaignBannerClosed,
  markCampaignBannerShown,
  readVisitorMemory,
} from "@/lib/campaign-banners/visitor-memory";
import { CampaignBar } from "./campaign-bar";
import { CampaignPopup } from "./campaign-popup";
import { useCampaignTrigger } from "./use-campaign-trigger";

type Picked = {
  popup: StorefrontCampaignBanner | null;
  bar: StorefrontCampaignBanner | null;
};

/**
 * Decides, in the visitor's browser, which Campaign Banners to show and when.
 *
 * The page it sits on is one cached render shared by everyone, so the server
 * can only hand over every banner that is or is about to be live. Here the
 * visitor's own state narrows that to at most one popup and one bar
 * (`pickCampaignBanners`: schedule against THIS clock, device, what they have
 * closed or signed up to) and the trigger decides the moment.
 *
 * Nothing renders on the server or during hydration — a banner that depends
 * on browser state must not be in the HTML — and the choice is made once per
 * set of banners, not on every render, so a popup that is open is not
 * withdrawn by the act of having been shown.
 */
export function CampaignBannerHost({
  banners,
}: {
  banners: StorefrontCampaignBanner[];
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [barDismissed, setBarDismissed] = useState(false);

  // The banners as the server rendered them. A new array with the same
  // content (a re-render of the page) must not re-run the choice.
  const signature = banners
    .map((banner) => `${banner.id}:${banner.updatedAt}`)
    .join("|");

  useEffect(() => {
    if (banners.length === 0) return;
    const device = window.matchMedia("(max-width: 767px)").matches
      ? "mobile"
      : "desktop";
    setPicked(
      pickCampaignBanners(banners, {
        now: new Date(),
        device,
        memory: readVisitorMemory(),
      }),
    );
    // `signature` stands for `banners`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const popup = picked?.popup ?? null;
  const bar = picked?.bar ?? null;
  const popupReady = useCampaignTrigger(popup?.rules.trigger ?? null);
  const barReady = useCampaignTrigger(bar?.rules.trigger ?? null);

  const popupOpen = Boolean(popup) && popupReady && !popupDismissed;
  const barVisible = Boolean(bar) && barReady && !barDismissed;

  const popupId = popup?.id;
  const barId = bar?.id;
  useEffect(() => {
    if (popupOpen && popupId) markCampaignBannerShown(popupId);
  }, [popupOpen, popupId]);
  useEffect(() => {
    if (barVisible && barId) markCampaignBannerShown(barId);
  }, [barVisible, barId]);

  if (!popup && !bar) return null;

  return (
    <>
      {bar && barVisible ? (
        <CampaignBar
          banner={bar}
          onDismiss={() => {
            markCampaignBannerClosed(bar.id);
            setBarDismissed(true);
          }}
        />
      ) : null}
      {popup ? (
        <CampaignPopup
          banner={popup}
          open={popupOpen}
          onDismiss={() => {
            markCampaignBannerClosed(popup.id);
            setPopupDismissed(true);
          }}
        />
      ) : null}
    </>
  );
}
