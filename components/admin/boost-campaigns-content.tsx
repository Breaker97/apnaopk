"use client";

import { useState } from "react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useBoostCampaignActions } from "@/components/admin/boost-campaign-actions";
import { BoostCampaignsTable } from "@/components/admin/boost-campaigns-table";
import { ManualBoostDialog } from "@/components/admin/manual-boost-dialog";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";

/**
 * Admin moderation view over every vendor's boost campaigns, plus the manual
 * (offline-payment) booking flow — the admin recording a booking IS the payment
 * verification, so it is paid the moment it is created.
 */
export function BoostCampaignsContent(props: {
  locale: string;
  data: BoostCampaignListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Sellers that hold at least one booking, for the vendor filter. */
  vendorOptions: Array<{ value: string; label: string }>;
  /** Ladder rungs, for the position filter the ladder's "View bookings" sets. */
  positionOptions: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const { buildActions } = useBoostCampaignActions();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <BoostCampaignsTable
        area="admin"
        locale={props.locale}
        data={props.data}
        pagination={props.pagination}
        vendorOptions={props.vendorOptions}
        positionOptions={props.positionOptions}
        onAdd={() => setCreateOpen(true)}
        rowActions={buildActions}
      />
      <ManualBoostDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
