"use client";

import { useId, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  CircleAlert,
  Download,
  FileSpreadsheet,
  Loader2,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { csvLine } from "@/lib/catalog/csv";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
} from "@/lib/products/import-limits";
import { cn } from "@/lib/utils";

type CollectionImportResult = {
  created: number;
  updated: number;
  failed: number;
  /** Row 0 is a problem with the file as a whole. */
  errors: { row: number; message: string }[];
  warnings?: string[];
};

interface CollectionImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The collections import-export route; its sample file lives under `/sample`. */
  endpoint: string;
  /** Called once an import created or updated at least one collection. */
  onImported: () => void;
}

/** The guide's columns, most-needed first. */
const COLUMN_GUIDE: Array<{ column: string; required?: boolean }> = [
  { column: "title", required: true },
  { column: "slug" },
  { column: "id" },
  { column: "description" },
  { column: "descriptionHtml" },
  { column: "imageUrl" },
  { column: "imageAlt" },
  { column: "collectionType" },
  { column: "status" },
  { column: "products" },
  { column: "productIds" },
  { column: "conditions" },
  { column: "conditionMatch" },
  { column: "sortOrder" },
  { column: "position" },
  { column: "onlineStore" },
  { column: "pointOfSale" },
  { column: "seoPageTitle" },
  { column: "seoMetaDescription" },
];

const CONDITIONS_EXAMPLE = '[{"field":"price","operator":"less_than","value":"50"}]';

/** Errors listed in the dialog; the downloadable list carries all of them. */
const VISIBLE_ERRORS = 100;

const MAX_FILE_MB = MAX_IMPORT_FILE_BYTES / (1024 * 1024);

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download the sample import file from `endpoint`. Throws when the request
 * fails, so each caller says so in its own place.
 */
export async function downloadCollectionImportSample(endpoint: string) {
  const response = await fetch(`${endpoint}/sample`);
  if (!response.ok) throw new Error("Sample download failed");
  saveBlob(await response.blob(), "collection-import-sample.csv");
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function CollectionImportDialog({
  open,
  onOpenChange,
  endpoint,
  onImported,
}: CollectionImportDialogProps) {
  const t = useTranslations("admin.collectionsDataTable.importDialog");
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    fileName: string;
    data: CollectionImportResult;
  } | null>(null);

  const reset = () => {
    setFile(null);
    setFileError(null);
    setRequestError(null);
    setResult(null);
  };

  const handleOpenChange = (next: boolean) => {
    // Closing mid-import would hide the outcome of a request still writing.
    if (isImporting) return;
    onOpenChange(next);
    if (!next) reset();
  };

  const pickFile = (candidate: File | undefined) => {
    if (!candidate) return;
    setRequestError(null);
    if (!/\.csv$/i.test(candidate.name)) {
      setFile(null);
      setFileError(t("wrongType"));
      return;
    }
    if (candidate.size > MAX_IMPORT_FILE_BYTES) {
      setFile(null);
      setFileError(t("fileTooLarge", { size: MAX_FILE_MB }));
      return;
    }
    setFileError(null);
    setFile(candidate);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  const handleDownloadSample = async () => {
    setIsDownloading(true);
    try {
      await downloadCollectionImportSample(endpoint);
    } catch {
      toast.error(t("sampleFailed"));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleImport = async () => {
    if (!file || isImporting) return;
    setIsImporting(true);
    setRequestError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(endpoint, { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: CollectionImportResult;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        setRequestError(payload?.message || payload?.error || t("requestFailed"));
        return;
      }
      setResult({ fileName: file.name, data: payload.data });
      if (payload.data.created > 0 || payload.data.updated > 0) onImported();
    } catch {
      setRequestError(t("requestFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  const data = result?.data;
  const nothingImported = Boolean(data && data.created === 0 && data.updated === 0);
  const fileRejected = Boolean(
    nothingImported && data?.errors.some((error) => error.row === 0),
  );

  const downloadErrors = () => {
    if (!result) return;
    const lines = [
      "row,message",
      ...result.data.errors.map((error) =>
        csvLine([error.row === 0 ? "file" : error.row, error.message]),
      ),
    ];
    const baseName = result.fileName.replace(/\.[^.]+$/, "");
    saveBlob(
      new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }),
      `${baseName}-import-errors.csv`,
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!isImporting}
      >
        <DialogHeader>
          <DialogTitle>
            {!data
              ? t("title")
              : fileRejected
                ? t("resultFailedTitle")
                : t("resultTitle")}
          </DialogTitle>
          <DialogDescription className="break-words">
            {result ? result.fileName : t("description")}
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <div className="min-w-0 space-y-4">
            {!fileRejected && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: t("created"), value: data.created, tone: "text-emerald-600 dark:text-emerald-400" },
                  { label: t("updated"), value: data.updated, tone: "text-sky-600 dark:text-sky-400" },
                  { label: t("failed"), value: data.failed, tone: data.failed > 0 ? "text-destructive" : "text-muted-foreground" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg border px-3 py-3 text-center">
                    <p className={cn("text-2xl font-semibold tabular-nums", stat.tone)}>
                      {stat.value}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>
            )}

            {data.warnings && data.warnings.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{t("warnings")}</p>
                  {data.warnings.slice(0, VISIBLE_ERRORS).map((warning) => (
                    <p key={warning} className="break-words">{warning}</p>
                  ))}
                </div>
              </div>
            )}

            {data.errors.length > 0 && (
              <div className="space-y-2">
                <div className="overflow-hidden rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                    <p className="text-sm font-medium">{t("errorsTitle")}</p>
                    <Button type="button" variant="ghost" size="sm" onClick={downloadErrors}>
                      <Download className="h-4 w-4" />
                      {t("downloadErrors")}
                    </Button>
                  </div>
                  <ul className="max-h-64 divide-y overflow-y-auto text-sm">
                    {data.errors.slice(0, VISIBLE_ERRORS).map((error, index) => (
                      <li key={`${error.row}-${index}`} className="flex gap-3 px-3 py-2">
                        <span className="w-20 shrink-0 font-medium tabular-nums text-muted-foreground">
                          {error.row === 0 ? t("fileLabel") : t("rowLabel", { row: error.row })}
                        </span>
                        <span className="min-w-0 break-words">{error.message}</span>
                      </li>
                    ))}
                  </ul>
                  {data.errors.length > VISIBLE_ERRORS && (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      {t("moreErrors", { count: data.errors.length - VISIBLE_ERRORS })}
                    </p>
                  )}
                </div>
                {!fileRejected && (
                  <p className="text-xs text-muted-foreground">{t("errorsHint")}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex gap-3">
                <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t("sampleTitle")}</p>
                    <p className="text-sm text-muted-foreground">{t("sampleDescription")}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isDownloading}
                    onClick={handleDownloadSample}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {t("sampleCsv")}
                  </Button>
                </div>
              </div>
            </div>

            <input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={isImporting}
              onChange={(event) => {
                pickFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
                <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isImporting}
                  aria-label={t("removeFile")}
                  onClick={() => setFile(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <label
                htmlFor={inputId}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors hover:bg-muted/40",
                  isDragging && "border-primary bg-primary/5",
                )}
              >
                <UploadCloud className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">{t("dropTitle")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("dropHint", { rows: MAX_IMPORT_ROWS.toLocaleString(), size: MAX_FILE_MB })}
                </span>
              </label>
            )}

            {(fileError || requestError) && (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 break-words">{fileError || requestError}</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("rulesTitle")}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t("rules.match")}</li>
                <li>{t("rules.blank")}</li>
                <li>{t("rules.products")}</li>
                <li>{t("rules.conditions")}</li>
              </ul>
            </div>

            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                {t("columnsTitle")}
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <dl className="divide-y border-t text-sm">
                {COLUMN_GUIDE.map((entry) => (
                  <div
                    key={entry.column}
                    className="grid gap-1 px-4 py-2.5 sm:grid-cols-[12rem_1fr] sm:gap-4"
                  >
                    <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <code className="font-mono text-xs">{entry.column}</code>
                      {entry.required && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          {t("required")}
                        </span>
                      )}
                    </dt>
                    <dd className="min-w-0 text-muted-foreground">
                      {t(`columns.${entry.column}`)}
                      {entry.column === "conditions" && (
                        <code
                          dir="ltr"
                          className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-xs"
                        >
                          {CONDITIONS_EXAMPLE}
                        </code>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>

            {isImporting && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("importing")}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {data ? (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                {t("importAnother")}
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t("done")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isImporting}
                onClick={() => handleOpenChange(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="button" disabled={!file || isImporting} onClick={handleImport}>
                {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("submit")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
