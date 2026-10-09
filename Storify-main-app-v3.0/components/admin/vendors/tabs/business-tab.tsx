"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { VendorTabProps } from "../vendor-detail-types";

/** What a payout run needs before the money has anywhere to go. */
const REQUIRED_BANK_FIELDS = [
  ["bankAccountName", "account name"],
  ["bankAccountNumber", "account number"],
  ["bankName", "bank name"],
] as const;

export function BusinessTab({ form, setField, readOnly }: VendorTabProps) {
  // Nothing in the payout flow reads these fields, so an incomplete account
  // never blocks a payout from being recorded — it just means the recorded
  // payout has no destination. Saying so here is the only warning there is.
  const missing = REQUIRED_BANK_FIELDS.filter(
    ([key]) => !String(form[key] || "").trim(),
  ).map(([, label]) => label);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business & Payment Details</CardTitle>
        <CardDescription>
          Bank account used for vendor payouts. Provided by the vendor or entered
          by an admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {missing.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Incomplete payout account</AlertTitle>
            <AlertDescription>
              Missing {missing.join(", ")}. Payouts for this vendor can still be
              recorded, but there is no account to send them to.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vendor-bank-account-name">Account name</Label>
            <Input
              id="vendor-bank-account-name"
              value={form.bankAccountName}
              onChange={(e) => setField("bankAccountName", e.target.value)}
              placeholder="e.g. Brennan Mccormick"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-bank-account-number">Account number</Label>
            <Input
              id="vendor-bank-account-number"
              value={form.bankAccountNumber}
              onChange={(e) => setField("bankAccountNumber", e.target.value)}
              placeholder="e.g. 0001234567"
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="vendor-bank-name">Bank name</Label>
          <Input
            id="vendor-bank-name"
            value={form.bankName}
            onChange={(e) => setField("bankName", e.target.value)}
            placeholder="e.g. First National Bank"
            disabled={readOnly}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vendor-bank-routing">Routing number</Label>
            <Input
              id="vendor-bank-routing"
              value={form.bankRoutingNumber}
              onChange={(e) => setField("bankRoutingNumber", e.target.value)}
              placeholder="Optional"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-bank-swift">SWIFT / BIC code</Label>
            <Input
              id="vendor-bank-swift"
              value={form.bankSwiftCode}
              onChange={(e) => setField("bankSwiftCode", e.target.value)}
              placeholder="Optional"
              disabled={readOnly}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
