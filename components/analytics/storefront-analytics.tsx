"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getAnalyticsConsent,
  trackPageView,
  type AnalyticsConfig,
  warnAboutDirectAndGtmDuplicates,
} from "@/lib/analytics/events";

type StorefrontAnalyticsProps = AnalyticsConfig;

export function StorefrontAnalytics({
  googleAnalyticsId,
  googleTagManagerId,
  facebookPixelId,
  tiktokPixelId,
}: StorefrontAnalyticsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [consent, setConsent] = useState<"granted" | "denied">(() =>
    getAnalyticsConsent(),
  );

  const config = useMemo(
    () => ({
      googleAnalyticsId,
      googleTagManagerId,
      facebookPixelId,
      tiktokPixelId,
    }),
    [
      googleAnalyticsId,
      googleTagManagerId,
      facebookPixelId,
      tiktokPixelId,
    ],
  );
  const canLoad = consent === "granted";

  useEffect(() => {
    const handleConsentChange = () => {
      setConsent(getAnalyticsConsent());
    };

    window.addEventListener("storify:analytics-consent", handleConsentChange);
    return () => {
      window.removeEventListener(
        "storify:analytics-consent",
        handleConsentChange,
      );
    };
  }, []);

  useEffect(() => {
    window.storifyAnalyticsConfig = config;
    warnAboutDirectAndGtmDuplicates(config);
  }, [config]);

  useEffect(() => {
    if (!canLoad) return;
    const query = searchParams.toString();
    trackPageView(query ? `${pathname}?${query}` : pathname);
  }, [canLoad, pathname, searchParams]);

  if (!canLoad) return null;

  return (
    <>
      {googleTagManagerId && (
        <>
          <Script id="storify-gtm-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});
            `}
          </Script>
          <Script
            id="storify-gtm"
            src={`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(
              googleTagManagerId,
            )}`}
            strategy="afterInteractive"
          />
        </>
      )}

      {googleAnalyticsId && (
        <>
          <Script
            id="storify-ga4"
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
              googleAnalyticsId,
            )}`}
            strategy="afterInteractive"
          />
          <Script id="storify-ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = window.gtag || gtag;
              gtag('js', new Date());
              gtag('config', '${googleAnalyticsId}', { send_page_view: false });
            `}
          </Script>
        </>
      )}

      {facebookPixelId && (
        <Script id="storify-meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${facebookPixelId}');
          `}
        </Script>
      )}

      {tiktokPixelId && (
        <Script id="storify-tiktok-pixel" strategy="afterInteractive">
          {`
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
              ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],
              ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
              for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
              ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
              ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
              ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
              var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;
              var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
              ttq.load('${tiktokPixelId}');
            }(window, document, 'ttq');
          `}
        </Script>
      )}
    </>
  );
}
