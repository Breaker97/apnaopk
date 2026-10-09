"use client";

import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  CustomerFormValues,
  CustomerTabProps,
  LoyaltyTier,
} from "../customer-detail-types";

interface LoyaltyTabProps extends CustomerTabProps {
  lifetimePoints: number;
}

const TIER_ORDER: LoyaltyTier[] = ["bronze", "silver", "gold", "platinum"];

const TIER_LABEL: Record<LoyaltyTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

export function LoyaltyTab({
  form,
  setField,
  readOnly,
  lifetimePoints,
}: LoyaltyTabProps) {
  const tierIndex = TIER_ORDER.indexOf(form.loyaltyTier);
  const progress =
    tierIndex >= 0 ? ((tierIndex + 1) / TIER_ORDER.length) * 100 : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Loyalty & Rewards</CardTitle>
          <CardDescription>
            Adjust the customer&apos;s points balance and tier
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Loyalty tier</Label>
              <Select
                value={form.loyaltyTier}
                disabled={readOnly}
                onValueChange={(value) =>
                  setField(
                    "loyaltyTier",
                    value as CustomerFormValues["loyaltyTier"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tier" />
                </SelectTrigger>
                <SelectContent>
                  {TIER_ORDER.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      {TIER_LABEL[tier]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer-loyalty-points">
                Current points balance
              </Label>
              <NumberInput
                id="customer-loyalty-points"
                min={0}
                step={1}
                value={form.loyaltyPoints}
                whenEmpty={0}
                normalize={Math.trunc}
                onValueChange={(next) => setField("loyaltyPoints", next ?? 0)}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Tier progress</span>
              <span className="text-muted-foreground">
                {TIER_LABEL[form.loyaltyTier]}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-all",
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              {TIER_ORDER.map((tier) => (
                <span key={tier}>{TIER_LABEL[tier]}</span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>Lifetime loyalty snapshot</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Current balance
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {form.loyaltyPoints.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                pts
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Lifetime points earned
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {(lifetimePoints ?? 0).toLocaleString()}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                pts
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
