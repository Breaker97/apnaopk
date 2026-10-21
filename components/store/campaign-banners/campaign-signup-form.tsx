"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, describeApiError } from "@/lib/api/client";
import { markCampaignBannerConverted } from "@/lib/campaign-banners/visitor-memory";
import type { StorefrontCampaignBanner } from "@/lib/campaign-banners/types";
import {
  CampaignBannerCoupon,
  useCampaignBannerText,
} from "./campaign-banner-parts";

/**
 * The popup's email form, and what it turns into afterwards: a thank-you and,
 * when the banner offers one, the code. The honeypot (`website`) is a field a
 * person never sees; the server treats a filled one as a script.
 */
export function CampaignSignupForm({
  banner,
  buttonStyle,
  preview = false,
}: {
  banner: StorefrontCampaignBanner;
  buttonStyle?: CSSProperties;
  /** The dashboard's preview: shows the thank-you step and sends nothing. */
  preview?: boolean;
}) {
  const say = useCampaignBannerText();
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  const { signup } = banner;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (status === "sending") return;
    // The form is `noValidate` (so the message below can be translated), which
    // leaves the browser's own email check off: do the obvious one here, since
    // every request counts against a small per-visitor allowance.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(say("invalidEmail", "Enter a valid email address"));
      return;
    }
    if (preview) {
      setStatus("done");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const result = await apiClient.post<{ couponCode?: string }>(
        `/api/campaign-banners/${banner.id}/signup`,
        { email: email.trim(), website, locale },
      );
      markCampaignBannerConverted(banner.id);
      setCode(result?.couponCode ?? "");
      setStatus("done");
    } catch (err) {
      setError(
        describeApiError(
          err,
          say("signupFailed", "We could not sign you up. Please try again."),
        ),
      );
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="space-y-3" role="status">
        <p className="text-lg font-semibold">
          {signup.successHeadline || say("successTitle", "You're in!")}
        </p>
        <p className="text-sm opacity-80">
          {signup.successText ||
            say("successText", "Check your inbox to confirm your subscription.")}
        </p>
        {code ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide opacity-70">
              {say("yourCode", "Your code")}
            </p>
            <CampaignBannerCoupon banner={{ couponCode: code, couponOffer: banner.couponOffer }} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            // The message was about the last attempt, not about this text.
            if (error) setError("");
          }}
          placeholder={
            signup.placeholder || say("emailPlaceholder", "Your email address")
          }
          aria-label={say("emailLabel", "Email address")}
          className="h-10 bg-background text-foreground"
        />
        <Button
          type="submit"
          disabled={status === "sending"}
          className="h-10 shrink-0 rounded-full px-5"
          style={buttonStyle}
        >
          {status === "sending" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            signup.buttonLabel || say("subscribe", "Subscribe")
          )}
        </Button>
      </div>
      {/* Honeypot: off-screen, out of the tab order, unlabelled for assistive tech. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs opacity-70">
        {signup.consentText ||
          say(
            "consent",
            "By subscribing you agree to get marketing emails. Unsubscribe any time.",
          )}
      </p>
    </form>
  );
}
