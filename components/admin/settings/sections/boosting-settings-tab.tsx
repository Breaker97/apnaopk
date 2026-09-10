"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import type { Settings } from "@/components/admin/settings/types";
import { SettingSwitchRow } from "@/components/admin/settings/fields/setting-switch-row";
import { PlatformPaymentMethodsField } from "@/components/admin/settings/fields/platform-payment-methods-field";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { MAX_PLACEMENT_DEPTH } from "@/lib/boosts/boost-placement-depths";
import {
  BOOST_HOLD_MAX_MINUTES,
  BOOST_HOLD_MIN_MINUTES,
} from "@/config/app.config";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Feature gate, storefront depths and booking rules for paid product boosting.
 *
 * Pricing lives on the position ladder (/admin/boosts/positions); the home
 * section's title and limit live in the home-page builder — which is why the
 * home depth is absent here and the ladder-depth line below reads it back.
 */
export function BoostingSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";
  const boosting = props.settings.boosting;
  const enabled = boosting?.enabled ?? false;

  const label = useFallbackTranslator(t);

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={label("admin.settings.boosting.title", "Product Boosting")}
        description={label(
          "admin.settings.boosting.description",
          "Let vendors pay to promote their products in sponsored placements across the storefront.",
        )}
      />

      <Card>
        <CardContent className="space-y-4">
          <SettingSwitchRow
            title={label("admin.settings.boosting.enable", "Enable boosting")}
            description={label(
              "admin.settings.boosting.enableDescription",
              "Master switch. When off, nothing is shown on the storefront and vendors cannot purchase boosts.",
            )}
            checked={enabled}
            onCheckedChange={(v) => props.updateField("boosting.enabled", v)}
          />
          {enabled ? (
            <Link
              href={`/${locale}/admin/boosts/positions`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              {label(
                "admin.settings.boosting.managePositions",
                "Manage the position ladder & pricing",
              )}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <p className="font-medium">
              {label(
                "admin.settings.boosting.paymentMethods",
                "Payment methods",
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {label(
                "admin.settings.boosting.paymentMethodsDescription",
                "Which gateways vendors may pay boosts through. Credentials are configured in Payment Settings.",
              )}
            </p>
          </div>
          <PlatformPaymentMethodsField
            settings={props.settings}
            value={boosting?.paymentMethods}
            onChange={(key, v) =>
              props.updateField(`boosting.paymentMethods.${key}`, v)
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <p className="font-medium">
              {label("admin.settings.boosting.placements", "Placements")}
            </p>
            <p className="text-sm text-muted-foreground">
              {label(
                "admin.settings.boosting.placementsDescription",
                "Where sponsored products appear on the storefront.",
              )}
            </p>
          </div>
          <SettingSwitchRow
            title={label(
              "admin.settings.boosting.placementHome",
              "Home page section",
            )}
            checked={boosting?.placements?.home ?? true}
            onCheckedChange={(v) =>
              props.updateField("boosting.placements.home", v)
            }
          />
          <SettingSwitchRow
            title={label(
              "admin.settings.boosting.placementListing",
              "Shop & category listings",
            )}
            checked={boosting?.placements?.listing ?? true}
            onCheckedChange={(v) =>
              props.updateField("boosting.placements.listing", v)
            }
          />
          <SettingSwitchRow
            title={label(
              "admin.settings.boosting.placementProductPage",
              "Product page carousel",
            )}
            checked={boosting?.placements?.productPage ?? true}
            onCheckedChange={(v) =>
              props.updateField("boosting.placements.productPage", v)
            }
          />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {label(
                  "admin.settings.boosting.listingSlots",
                  "Ladder depth on listing pages",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {label(
                  "admin.settings.boosting.listingSlotsDescription",
                  "How many of the top ladder positions render on shop and category pages (1–12). Positions below this depth simply do not appear there.",
                )}
              </p>
            </div>
            <NumberInput
              min={1}
              max={MAX_PLACEMENT_DEPTH}
              step={1}
              className="w-20"
              value={boosting?.listingSlots ?? 2}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("boosting.listingSlots", next);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {label(
                  "admin.settings.boosting.productPageSlots",
                  "Ladder depth on product pages",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {label(
                  "admin.settings.boosting.productPageSlotsDescription",
                  "How many of the top ladder positions render in the product-page rail (1–12).",
                )}
              </p>
            </div>
            <NumberInput
              min={1}
              max={MAX_PLACEMENT_DEPTH}
              step={1}
              className="w-20"
              value={boosting?.productPageSlots ?? 8}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("boosting.productPageSlots", next);
              }}
            />
          </div>
          {/* The depths together decide which rungs are sellable at all: a
              position deeper than every one of them renders nowhere and is
              withheld from the vendor ladder. Saying so here is cheaper than
              discovering it from the "renders nowhere" banner. */}
          <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
            {label(
              "admin.settings.boosting.ladderDepth",
              "Positions deeper than the largest of these depths render nowhere and cannot be sold.",
            )}
          </p>
          <SettingSwitchRow
            title={label(
              "admin.settings.boosting.hideOutOfStock",
              "Hide out-of-stock products",
            )}
            description={label(
              "admin.settings.boosting.hideOutOfStockDescription",
              // No longer cosmetic: the slot falls to a regular product AND the
              // vendor is credited for that day, so switching this on is opting
              // into refunds rather than into a filter.
              "A booked product that sells out is dropped from its slot, and the vendor is credited in proportion for that day.",
            )}
            checked={boosting?.hideOutOfStock ?? true}
            onCheckedChange={(v) =>
              props.updateField("boosting.hideOutOfStock", v)
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <p className="font-medium">
              {label("admin.settings.boosting.booking", "Booking rules")}
            </p>
            <p className="text-sm text-muted-foreground">
              {label(
                "admin.settings.boosting.bookingDescription",
                "How far ahead vendors may book, how long a booking may run, and how long an unpaid checkout holds its days.",
              )}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {label(
                  "admin.settings.boosting.bookingHorizonDays",
                  "Booking horizon (days)",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {label(
                  "admin.settings.boosting.bookingHorizonDaysDescription",
                  "How far into the future the calendar opens (7–365).",
                )}
              </p>
            </div>
            <NumberInput
              min={7}
              max={365}
              step={1}
              className="w-20"
              value={boosting?.bookingHorizonDays ?? 60}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("boosting.bookingHorizonDays", next);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {label(
                  "admin.settings.boosting.maxBookingDays",
                  "Longest single booking (days)",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {label(
                  "admin.settings.boosting.maxBookingDaysDescription",
                  "Stops one vendor holding a position for a whole season in one transaction (1–365).",
                )}
              </p>
            </div>
            <NumberInput
              min={1}
              max={365}
              step={1}
              className="w-20"
              value={boosting?.maxBookingDays ?? 60}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("boosting.maxBookingDays", next);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {label(
                  "admin.settings.boosting.holdMinutes",
                  "Checkout hold (minutes)",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {label(
                  "admin.settings.boosting.holdMinutesDescription",
                  // The 35 floor is a Stripe constraint, not a preference:
                  // checkout.session.expires_at must be at least 30 minutes
                  // out, measured from session creation.
                  "How long an unpaid checkout keeps its days off the market (35–120). Below 35 Stripe rejects the checkout session.",
                )}
              </p>
            </div>
            <NumberInput
              min={BOOST_HOLD_MIN_MINUTES}
              max={BOOST_HOLD_MAX_MINUTES}
              step={1}
              className="w-20"
              value={boosting?.holdMinutes ?? 45}
              whenEmpty="keep"
              normalize={Math.trunc}
              onValueChange={(next) => {
                if (next !== undefined) props.updateField("boosting.holdMinutes", next);
              }}
            />
          </div>
          <StickySaveFooter
            label={label("admin.settings.saveChanges", "Save changes")}
            isSaving={props.isSaving}
            isDirty={props.isDirty}
            disabled={props.isSaving || !props.isDirty}
            onSave={props.onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
