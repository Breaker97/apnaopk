"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Columns3, Download, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChunkedImportDialog,
  type ChunkedImportEntity,
  type ImportFinished,
  type ImportMessage,
} from "@/components/admin/csv-import/chunked-import-dialog";
import { SetupGuide, SetupGuideSection } from "@/components/admin/setup-guide";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
} from "@/components/admin/settings/fields/setting-row";
import { csvLine } from "@/lib/catalog/csv";
import { useAppSettings } from "@/providers/app-settings-provider";
import {
  checkVendorHeaders,
  normalizeVendorEmail,
  readVendorCells,
  VENDOR_IMPORT_CHUNK_ROWS,
  VENDOR_IMPORT_MAX_FILE_BYTES,
  VENDOR_IMPORT_MAX_ROWS,
  VENDOR_SAMPLE_ROWS,
  VENDOR_TEMPLATE_COLUMNS,
} from "@/lib/vendors/vendor-import-format";

/**
 * Admin → Vendors → Import: stores and their owners from another marketplace,
 * previewed, then imported a few rows at a time (`ChunkedImportDialog`) —
 * each row may copy a logo and a banner into the store's media storage.
 */

/** What the page knows about plans, so the file's check can say what the import will do. */
export interface VendorImportContext {
  plansEnabled: boolean;
  /** The plan new stores open on; a paid one is never assigned by an import. */
  defaultPlan: { name: string; paid: boolean } | null;
}

interface VendorImportOptions {
  updateExisting: boolean;
  startAs: "approved" | "pending";
}

const DEFAULT_OPTIONS: VendorImportOptions = { updateExisting: false, startAs: "approved" };
const ENDPOINT = "/api/admin/vendors/import";

function saveCsv(rows: string[][], filename: string) {
  const blob = new Blob([`﻿${rows.map((row) => csvLine(row)).join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function templateRows(): string[][] {
  return [
    VENDOR_TEMPLATE_COLUMNS.map((column) => column.header),
    ...VENDOR_SAMPLE_ROWS.map((row) => VENDOR_TEMPLATE_COLUMNS.map((column) => row[column.field] ?? "")),
  ];
}

export function VendorImportDialog({
  open,
  onOpenChange,
  context,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: VendorImportContext;
  onImported: () => void;
}) {
  const t = useTranslations("admin.vendorImport");
  const { storeName } = useAppSettings();
  const startAsId = useId();
  const [options, setOptions] = useState<VendorImportOptions>(DEFAULT_OPTIONS);

  const describe = useCallback(
    (message: ImportMessage) => {
      const params = { ...(message.params ?? {}) };
      if (message.code === "row_image_failed" && typeof params.reason === "string") {
        const reasonKey = `imageReasons.${params.reason}`;
        params.reason = t.has(reasonKey) ? t(reasonKey) : String(params.detail ?? params.reason);
      }
      const key = `messages.${message.code}`;
      return t.has(key) ? t(key, params) : t("messages.row_failed", { message: "" });
    },
    [t],
  );

  const entity = useMemo<ChunkedImportEntity>(
    () => ({
      endpoint: ENDPOINT,
      chunkSize: VENDOR_IMPORT_CHUNK_ROWS,
      maxFileBytes: VENDOR_IMPORT_MAX_FILE_BYTES,
      maxRows: VENDOR_IMPORT_MAX_ROWS,
      checkHeaders: (headers) => {
        const checked = checkVendorHeaders(headers);
        if (!checked.ok) return checked;
        const warnings = [...checked.warnings];
        // Said once for the file rather than on every row it touches.
        if (!context.plansEnabled && checked.map.columns.includes("plan")) {
          warnings.push({ code: "run_plans_off" });
        }
        if (context.plansEnabled && context.defaultPlan?.paid) {
          warnings.push({ code: "run_default_plan_paid", params: { plan: context.defaultPlan.name } });
        }
        return {
          ok: true,
          warnings,
          // The same owner twice: the later row is the one imported.
          rowKey: (cells) => normalizeVendorEmail(readVendorCells(checked.map, cells).ownerEmail),
        };
      },
      describe,
    }),
    [context.defaultPlan, context.plansEnabled, describe],
  );

  const guide = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("sourceHint", { storeName })}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => saveCsv(templateRows(), "vendor-import-template.csv")}
        >
          <Download className="h-4 w-4" />
          {t("downloadTemplate")}
        </Button>
      </div>
      <SetupGuide>
        <SetupGuideSection value="columns" icon={Columns3} title={t("guide.columnsTitle")}>
          <dl className="divide-y rounded-md border bg-background text-xs">
            {VENDOR_TEMPLATE_COLUMNS.map((column) => (
              <div
                key={column.field}
                className="grid gap-1 px-3 py-2 sm:grid-cols-[11rem_1fr] sm:gap-3"
              >
                <dt className="flex flex-wrap items-center gap-1.5">
                  <code className="font-mono">{column.header}</code>
                  {column.required && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {t("guide.required")}
                    </span>
                  )}
                </dt>
                <dd className="text-muted-foreground">{t(`guide.columns.${column.field}`)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{t("guide.notImported")}</p>
        </SetupGuideSection>
        <SetupGuideSection value="rules" icon={ListChecks} title={t("guide.rulesTitle")}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t("guide.rules.match")}</li>
            <li>{t("guide.rules.owner")}</li>
            <li>{t("guide.rules.plan")}</li>
            <li>{t("guide.rules.rerun")}</li>
          </ul>
        </SetupGuideSection>
      </SetupGuide>
    </div>
  );

  const renderOptions = (disabled: boolean) => (
    <SettingList>
      <SettingSwitchItem
        title={t("options.updateExisting")}
        description={t("options.updateExistingHint")}
        checked={options.updateExisting}
        disabled={disabled}
        onCheckedChange={(updateExisting) => setOptions((current) => ({ ...current, updateExisting }))}
      />
      <SettingRow
        inputId={startAsId}
        label={t("options.startAs")}
        hint={options.startAs === "approved" ? t("options.startAsApprovedHint") : t("options.startAsPendingHint")}
      >
        <Select
          value={options.startAs}
          disabled={disabled}
          onValueChange={(value) =>
            setOptions((current) => ({ ...current, startAs: value === "pending" ? "pending" : "approved" }))
          }
        >
          <SelectTrigger id={startAsId} className="w-full @md:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approved">{t("options.startAsApproved")}</SelectItem>
            <SelectItem value="pending">{t("options.startAsPending")}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </SettingList>
  );

  const renderFinished = (finished: ImportFinished | null) =>
    finished?.invitesQueued ? (
      <p className="text-sm text-muted-foreground">
        {t("result.invitesQueued", { count: finished.invitesQueued })}
      </p>
    ) : null;

  return (
    <ChunkedImportDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // A new import starts from the safe defaults again.
        if (!next) setOptions(DEFAULT_OPTIONS);
      }}
      entity={entity}
      title={t("title")}
      description={t("description")}
      options={options}
      renderOptions={renderOptions}
      guide={guide}
      renderFinished={renderFinished}
      onImported={onImported}
    />
  );
}
