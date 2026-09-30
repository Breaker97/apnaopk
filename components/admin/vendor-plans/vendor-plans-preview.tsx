"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VendorPlanPicker } from "@/components/vendor-plans/vendor-plan-picker";
import {
  toPublicVendorPlan,
  type AdminVendorPlan,
} from "@/components/admin/vendor-plans/types";

interface VendorPlansPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active plans, in the order vendors see them. */
  plans: AdminVendorPlan[];
}

/**
 * "Vendor view": the plan step of the become-a-vendor wizard, drawn from the
 * same picker the storefront uses, so the admin checks the result of an edit
 * without signing up as a vendor. Picking a card only moves the preview.
 */
export function VendorPlansPreview({
  open,
  onOpenChange,
  plans,
}: VendorPlansPreviewProps) {
  const publicPlans = useMemo(() => plans.map(toPublicVendorPlan), [plans]);
  const defaultId = publicPlans.find((plan) => plan.isDefault)?.id ?? null;
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPicked(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Vendor view</DialogTitle>
          <DialogDescription>
            The plan step vendors see when they sign up. Archived plans are
            hidden.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 py-2">
          <VendorPlanPicker
            plans={publicPlans}
            selectedId={picked ?? defaultId}
            onSelect={setPicked}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
