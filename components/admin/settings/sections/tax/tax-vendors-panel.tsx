"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import Link from "@/components/language/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/toast-notification";
import { SettingList } from "@/components/admin/settings/fields/setting-row";
import { cn } from "@/lib/utils";
import { TaxSection } from "./tax-layout";
import {
  VENDOR_TAX_CHANGE_POLICIES,
  type TaxSettings,
  type VendorTaxChangePolicy,
} from "@/lib/tax/tax-settings";
import type { ProductTax } from "@/lib/tax/vendor-tax";
import { useProductTaxLabel } from "@/components/admin/settings/fields/use-product-tax-label";

type RequestRow = {
  _id: string;
  vendorId: string;
  storeName: string;
  products: Array<{ productId: string; name: string; before: ProductTax }>;
  requested: ProductTax;
  reason: string;
  status: "pending" | "approved" | "declined" | "withdrawn";
  requestedAt: string;
  decidedAt?: string | null;
  decisionNote?: string | null;
};

const SHOWN_PRODUCTS = 3;

/** Where a request's answer stands: the note box opens on demand, and declining makes it required. */
type RowUi = { note: boolean; declining: boolean };

/**
 * Settings → Tax Settings → Vendors: who may change a vendor's product tax
 * (saved with the page), and the requests vendors sent under "with your
 * approval" — each answered on the spot, not with the page's Save.
 */
export function TaxVendorsPanel(props: {
  tax: TaxSettings;
  onChange: (next: TaxSettings) => void;
  /** The number of requests waiting, whenever this panel learns it (the tab's badge). */
  onPendingCount?: (count: number) => void;
}) {
  const t = useTranslations("admin.settings.tax.vendors");
  const { tax, onChange } = props;
  const policy = tax.marketplace.vendorTaxChanges;
  const policyCopy: Record<VendorTaxChangePolicy, { title: string; hint: string }> = {
    approval: { title: t("policy.approval"), hint: t("policy.approvalHint") },
    never: { title: t("policy.never"), hint: t("policy.neverHint") },
    free: { title: t("policy.free"), hint: t("policy.freeHint") },
  };

  return (
    <div className="space-y-6">
      <TaxSection title={t("policyTitle")} description={t("policyDescription")}>
        <RadioGroup
          value={policy}
          onValueChange={(next) =>
            onChange({ ...tax, marketplace: { vendorTaxChanges: next as VendorTaxChangePolicy } })
          }
          aria-label={t("policyTitle")}
          className="gap-0"
        >
          <SettingList>
            {VENDOR_TAX_CHANGE_POLICIES.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-muted/40",
                  policy === option && "bg-primary/5 hover:bg-primary/5",
                )}
              >
                <RadioGroupItem value={option} className="mt-0.5" />
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-medium">{policyCopy[option].title}</span>
                  <span className="text-muted-foreground block text-sm">{policyCopy[option].hint}</span>
                </span>
              </label>
            ))}
          </SettingList>
        </RadioGroup>
      </TaxSection>

      <TaxRequestsCard tax={tax} onPendingCount={props.onPendingCount} />
    </div>
  );
}

function TaxRequestsCard(props: { tax: TaxSettings; onPendingCount?: (count: number) => void }) {
  const t = useTranslations("admin.settings.tax.vendors");
  const locale = useLocale();
  const label = useProductTaxLabel(props.tax.classes);
  const { onPendingCount } = props;
  const [view, setView] = useState<"pending" | "decided">("pending");
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ui, setUi] = useState<Record<string, RowUi>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const uiOf = (id: string): RowUi => ui[id] ?? { note: false, declining: false };
  const setRowUi = (id: string, patch: Partial<RowUi>) =>
    setUi((current) => ({ ...current, [id]: { ...uiOf(id), ...patch } }));

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/tax-requests?status=${view}&limit=50`);
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) throw new Error(body?.message);
      setRows((body?.data?.data ?? []) as RequestRow[]);
      if (view === "pending" && typeof body?.data?.pagination?.total === "number") {
        onPendingCount?.(body.data.pagination.total);
      }
    } catch {
      setRows([]);
      toast.error(t("loadFailed"));
    }
  }, [t, view, onPendingCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row: RequestRow, decision: "approved" | "declined") => {
    const note = notes[row._id]?.trim();
    if (decision === "declined" && !note) {
      setRowUi(row._id, { note: true, declining: true });
      toast.error(t("noteRequired"));
      return;
    }
    setBusy(row._id);
    try {
      const response = await fetch(`/api/admin/tax-requests/${row._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) throw new Error(body?.message || t("decisionFailed"));
      toast.success(decision === "approved" ? t("approvedToast") : t("declinedToast"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("decisionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const statusLabel: Record<RequestRow["status"], string> = {
    pending: t("pending"),
    approved: t("approved"),
    declined: t("declined"),
    withdrawn: t("withdrawn"),
  };

  return (
    <TaxSection
      className="border-t pt-6"
      title={t("requestsTitle")}
      description={t("requestsDescription")}
      action={
        <div className="flex gap-1 rounded-lg border p-1">
          {(["pending", "decided"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={view === option ? "secondary" : "ghost"}
              aria-pressed={view === option}
              onClick={() => {
                setRows(null);
                setView(option);
              }}
            >
              {option === "pending" ? t("pendingTab") : t("decidedTab")}
            </Button>
          ))}
        </div>
      }
    >
      {rows === null ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{view === "pending" ? t("empty") : t("emptyDecided")}</p>
      ) : (
        <SettingList>
          {rows.map((row) => {
            const rowUi = uiOf(row._id);
            return (
              <div key={row._id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold">{row.storeName || t("unknownStore")}</p>
                  <p className="text-muted-foreground flex items-center gap-2 text-xs">
                    {view === "decided" ? (
                      <Badge variant={row.status === "approved" ? "default" : "secondary"}>
                        {statusLabel[row.status]}
                      </Badge>
                    ) : null}
                    {t("requestedOn", { date: formatDate(row.requestedAt) })}
                  </p>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {t("asksFor")}
                  <span className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-sm font-semibold">
                    {label(row.requested)}
                  </span>
                </p>
                <ul className="space-y-1 text-sm">
                  {row.products.slice(0, SHOWN_PRODUCTS).map((product) => (
                    <li key={product.productId} className="flex flex-wrap gap-x-2">
                      <Link
                        href={`/admin/products/${product.productId}/edit`}
                        className="text-primary hover:underline"
                      >
                        {product.name}
                      </Link>
                      <span className="text-muted-foreground">{t("now", { tax: label(product.before) })}</span>
                    </li>
                  ))}
                  {row.products.length > SHOWN_PRODUCTS ? (
                    <li className="text-muted-foreground">
                      {t("moreProducts", { count: row.products.length - SHOWN_PRODUCTS })}
                    </li>
                  ) : null}
                </ul>
                <div className="bg-muted/40 rounded-md p-3 text-sm">
                  <span className="text-muted-foreground block text-xs">{t("reason")}</span>
                  {row.reason}
                </div>
                {row.status === "pending" ? (
                  <div className="space-y-3">
                    {rowUi.note ? (
                      <div className="space-y-1.5">
                        <label htmlFor={`taxRequestNote-${row._id}`} className="text-sm font-medium">
                          {t("noteLabel")}
                          <span className="text-muted-foreground ms-1.5 font-normal">
                            {rowUi.declining ? t("noteRequiredHint") : t("optional")}
                          </span>
                        </label>
                        <Input
                          id={`taxRequestNote-${row._id}`}
                          autoFocus
                          maxLength={1000}
                          value={notes[row._id] ?? ""}
                          placeholder={t("notePlaceholder")}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [row._id]: event.target.value }))
                          }
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {!rowUi.note ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="me-auto h-auto px-0"
                          onClick={() => setRowUi(row._id, { note: true })}
                        >
                          {t("addNote")}
                        </Button>
                      ) : null}
                      {rowUi.declining ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy === row._id}
                            onClick={() => setRowUi(row._id, { declining: false, note: Boolean(notes[row._id]?.trim()) })}
                          >
                            {t("cancel")}
                          </Button>
                          <Button type="button" disabled={busy === row._id} onClick={() => void decide(row, "declined")}>
                            {t("sendDecline")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy === row._id}
                            onClick={() => setRowUi(row._id, { note: true, declining: true })}
                          >
                            {t("decline")}
                          </Button>
                          <Button type="button" disabled={busy === row._id} onClick={() => void decide(row, "approved")}>
                            <Check className="size-4" aria-hidden />
                            {t("approve")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : row.decisionNote ? (
                  <p className="text-muted-foreground text-sm">{t("decisionNote", { note: row.decisionNote })}</p>
                ) : null}
              </div>
            );
          })}
        </SettingList>
      )}
    </TaxSection>
  );
}
