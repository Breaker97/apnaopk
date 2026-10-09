"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";

/**
 * The shape the vendor settings endpoint reports: presence flags and masked
 * hints, never the tokens themselves.
 */
export interface VendorCarrierView {
  mode: "platform" | "own";
  shippo: {
    enabled: boolean;
    mode: "test" | "live";
    testTokenSet: boolean;
    liveTokenSet: boolean;
    testTokenHint?: string;
    liveTokenHint?: string;
  };
  shiprocket: {
    enabled: boolean;
    email?: string;
    passwordSet: boolean;
    pickupLocationName?: string;
  };
}

/** A vendor that has never opened this card. */
export const EMPTY_VENDOR_CARRIER_VIEW: VendorCarrierView = {
  mode: "platform",
  shippo: {
    enabled: false,
    mode: "test",
    testTokenSet: false,
    liveTokenSet: false,
  },
  shiprocket: { enabled: false, passwordSet: false },
};

/** Plaintext values typed in this session; blank means "leave it alone". */
export interface VendorCarrierDraft {
  mode?: "platform" | "own";
  shippo?: {
    enabled?: boolean;
    mode?: "test" | "live";
    testToken?: string;
    liveToken?: string;
  };
  shiprocket?: {
    enabled?: boolean;
    email?: string;
    password?: string;
    pickupLocationName?: string;
  };
}

/**
 * A vendor's own carrier account.
 *
 * Rendered only when the store administrator has switched carriers on —
 * otherwise there is no platform account to override and the choice would be
 * meaningless.
 */
export function VendorCarrierAccountCard(props: {
  view: VendorCarrierView;
  draft: VendorCarrierDraft;
  onChange: (next: VendorCarrierDraft) => void;
  /** True when the store origin is India; Shiprocket is refused otherwise. */
  shiprocketAvailable?: boolean;
}) {
  const { view, draft, onChange } = props;

  const mode = draft.mode ?? view.mode;
  const shippoEnabled = draft.shippo?.enabled ?? view.shippo.enabled;
  const shippoMode = draft.shippo?.mode ?? view.shippo.mode;
  const shiprocketEnabled =
    draft.shiprocket?.enabled ?? view.shiprocket.enabled;

  const patchShippo = (patch: NonNullable<VendorCarrierDraft["shippo"]>) =>
    onChange({ ...draft, shippo: { ...draft.shippo, ...patch } });
  const patchShiprocket = (
    patch: NonNullable<VendorCarrierDraft["shiprocket"]>,
  ) => onChange({ ...draft, shiprocket: { ...draft.shiprocket, ...patch } });

  return (
    <div className="rounded-lg border p-4 space-y-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Carrier account</h3>
        <p className="text-xs text-muted-foreground">
          Labels are bought from a carrier account. Use the store&apos;s, or
          connect your own so the shipping cost is billed to you.
        </p>
      </div>

      <RadioGroup
        value={mode}
        onValueChange={(value) =>
          onChange({ ...draft, mode: value as "platform" | "own" })
        }
      >
        <Label
          htmlFor="carrier-mode-platform"
          className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary"
        >
          <RadioGroupItem id="carrier-mode-platform" value="platform" />
          <span>
            <span className="block text-sm font-medium">
              Use the store&apos;s carrier account
            </span>
            <span className="block text-xs text-muted-foreground">
              Nothing to configure. The store is billed for labels.
            </span>
          </span>
        </Label>
        <Label
          htmlFor="carrier-mode-own"
          className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary"
        >
          <RadioGroupItem id="carrier-mode-own" value="own" />
          <span>
            <span className="block text-sm font-medium">
              Use my own carrier account
            </span>
            <span className="block text-xs text-muted-foreground">
              Your negotiated rates, billed to you.
            </span>
          </span>
        </Label>
      </RadioGroup>

      {mode === "own" ? (
        <div className="space-y-5">
          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="vendor-shippo-enabled">Shippo</Label>
              <Switch
                id="vendor-shippo-enabled"
                checked={shippoEnabled}
                onCheckedChange={(checked) => patchShippo({ enabled: checked })}
              />
            </div>

            {shippoEnabled ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="vendor-shippo-mode">Environment</Label>
                  <Select
                    value={shippoMode}
                    onValueChange={(value) =>
                      patchShippo({ mode: value as "test" | "live" })
                    }
                  >
                    <SelectTrigger id="vendor-shippo-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="test">Test</SelectItem>
                      <SelectItem value="live">Live</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <SecretInput
                  id="vendor-shippo-test"
                  label="Test API token"
                  value={draft.shippo?.testToken || ""}
                  onChange={(value) => patchShippo({ testToken: value })}
                  secretSet={view.shippo.testTokenSet}
                  maskedHint={view.shippo.testTokenHint}
                  placeholderWhenUnset="shippo_test_..."
                />
                <SecretInput
                  id="vendor-shippo-live"
                  label="Live API token"
                  value={draft.shippo?.liveToken || ""}
                  onChange={(value) => patchShippo({ liveToken: value })}
                  secretSet={view.shippo.liveTokenSet}
                  maskedHint={view.shippo.liveTokenHint}
                  placeholderWhenUnset="shippo_live_..."
                />
              </div>
            ) : null}
          </div>

          {props.shiprocketAvailable !== false ? (
            <>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="vendor-shiprocket-enabled">Shiprocket</Label>
                  <Switch
                    id="vendor-shiprocket-enabled"
                    checked={shiprocketEnabled}
                    onCheckedChange={(checked) =>
                      patchShiprocket({ enabled: checked })
                    }
                  />
                </div>

                {shiprocketEnabled ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="vendor-shiprocket-email">
                        API user email
                      </Label>
                      <Input
                        id="vendor-shiprocket-email"
                        value={
                          draft.shiprocket?.email ?? view.shiprocket.email ?? ""
                        }
                        onChange={(event) =>
                          patchShiprocket({ email: event.target.value })
                        }
                        placeholder="api-user@example.com"
                      />
                    </div>

                    <SecretInput
                      id="vendor-shiprocket-password"
                      label="API user password"
                      value={draft.shiprocket?.password || ""}
                      onChange={(value) => patchShiprocket({ password: value })}
                      secretSet={view.shiprocket.passwordSet}
                    />

                    <div className="space-y-2">
                      <Label htmlFor="vendor-shiprocket-pickup">
                        Pickup location
                      </Label>
                      <Input
                        id="vendor-shiprocket-pickup"
                        value={
                          draft.shiprocket?.pickupLocationName ??
                          view.shiprocket.pickupLocationName ??
                          ""
                        }
                        onChange={(event) =>
                          patchShiprocket({
                            pickupLocationName: event.target.value,
                          })
                        }
                        placeholder="Primary"
                      />
                      <p className="text-xs text-muted-foreground">
                        The nickname registered in your Shiprocket dashboard.
                        Nothing can be dispatched until it is set.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Leave a token field blank to keep the value already saved.
          </p>
        </div>
      ) : null}
    </div>
  );
}
