"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import {
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
import { csvLine, parseCsv } from "@/lib/catalog/csv";
import { cn } from "@/lib/utils";

/**
 * Importing a CSV a few hundred rows at a time, with a preview first: the
 * customers import, and the vendor import after it.
 *
 * The browser only reads the file and cuts it up. Each request carries its
 * rows' raw cells to the entity's route, which reads every row again and
 * answers what it would do (`dryRun`) or did: the preview is that answer for
 * the whole file before anything is written, the import is the same requests
 * for real. Only rows worth a look are listed — the first hundred on screen,
 * all of them in a downloadable CSV — and everything else is a count.
 *
 * Closing the tab stops an import after the request in flight; what was
 * imported stays, and the route ends the run so it is still recorded. Running
 * the same file again picks up where it stopped, because rows match existing
 * records.
 */

export interface ImportMessage {
  code: string;
  params?: Record<string, string | number>;
}

export type ImportRowStatus = "create" | "update" | "skip" | "error";

export interface ImportRowProblem {
  row: number;
  status: ImportRowStatus;
  /** The value the row was matched by (an email, a phone number, a handle). */
  key?: string;
  reason?: ImportMessage;
  warnings?: ImportMessage[];
}

export interface ImportCounts {
  create: number;
  update: number;
  skip: number;
  error: number;
}

/** What the route says when the last request of a run (or a stop) ends it. */
export interface ImportFinished {
  status: "finished" | "stopped";
  invitesQueued?: number;
}

export interface ChunkedImportEntity {
  /**
   * The route that takes `{ runId, dryRun, chunkIndex, final, stop, fileName,
   * options, headers, rows }`, plus `heldBack` (rows the file overruled) on a
   * run's first request.
   */
  endpoint: string;
  /** Rows per request — small enough for the route to answer well within its time. */
  chunkSize: number;
  maxFileBytes: number;
  maxRows: number;
  /**
   * The file's header row, checked before anything is sent: whether the
   * entity can match rows at all, the file-wide warnings, and the key the
   * "last row wins" rule groups rows by.
   */
  checkHeaders: (headers: string[]) =>
    | {
        ok: true;
        warnings: ImportMessage[];
        rowKey: (cells: string[]) => string | null;
      }
    | { ok: false; error: ImportMessage };
  /** A message in the admin's language. */
  describe: (message: ImportMessage) => string;
}

interface ChunkedImportDialogProps<TOptions> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: ChunkedImportEntity;
  title: string;
  description: string;
  options: TOptions;
  /** False while an option is not valid yet (an empty tag); the file cannot be checked. */
  optionsReady?: boolean;
  /** The options, shown while choosing the file; `disabled` once a run starts. */
  renderOptions: (disabled: boolean) => ReactNode;
  /** The sample file and the column guide. */
  guide: ReactNode;
  /** What else a finished run means (invitations queued, say). */
  renderFinished?: (finished: ImportFinished | null, options: TOptions) => ReactNode;
  /** Called once an import created or updated anything. */
  onImported: () => void;
}

type Prepared = {
  fileName: string;
  headers: string[];
  rows: Array<{ row: number; cells: string[] }>;
  /** Rows the file itself overrules: an earlier row for the same record. */
  localProblems: ImportRowProblem[];
  fileWarnings: ImportMessage[];
};

type Phase =
  | { step: "select" }
  | { step: "checking"; done: number }
  | { step: "preview" }
  | { step: "importing"; done: number; stopping: boolean }
  | { step: "result"; finished: ImportFinished | null; failure?: string };

const VISIBLE_PROBLEMS = 100;
const EMPTY_COUNTS: ImportCounts = { create: 0, update: 0, skip: 0, error: 0 };

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

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function newRunId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function addCounts(total: ImportCounts, add: ImportCounts): ImportCounts {
  return {
    create: total.create + add.create,
    update: total.update + add.update,
    skip: total.skip + add.skip,
    error: total.error + add.error,
  };
}

/**
 * Cut the file into the requests it will be sent as. Of several rows for one
 * record, the last is kept and the others are reported, as Shopify does.
 */
function prepareFile(
  fileName: string,
  headers: string[],
  records: Array<{ row: number; values: Record<string, string> }>,
  rowKey: (cells: string[]) => string | null,
  warnings: ImportMessage[],
): Prepared {
  const all = records.map(({ row, values }) => ({
    row,
    cells: headers.map((header) => values[header] ?? ""),
  }));
  const keys = all.map((record) => rowKey(record.cells));
  const lastRowByKey = new Map<string, number>();
  keys.forEach((key, index) => {
    if (key) lastRowByKey.set(key, all[index].row);
  });

  const rows: Prepared["rows"] = [];
  const localProblems: ImportRowProblem[] = [];
  all.forEach((record, index) => {
    const key = keys[index];
    const winner = key ? lastRowByKey.get(key) : undefined;
    if (key && winner !== record.row) {
      localProblems.push({
        row: record.row,
        status: "skip",
        key: key.replace(/^[a-z]+:/, ""),
        reason: { code: "duplicate_in_file", params: { row: winner as number } },
      });
      return;
    }
    rows.push(record);
  });
  return { fileName, headers, rows, localProblems, fileWarnings: warnings };
}

export function ChunkedImportDialog<TOptions>({
  open,
  onOpenChange,
  entity,
  title,
  description,
  options,
  optionsReady = true,
  renderOptions,
  guide,
  renderFinished,
  onImported,
}: ChunkedImportDialogProps<TOptions>) {
  const t = useTranslations("admin.csvImport");
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "select" });
  const [counts, setCounts] = useState<ImportCounts>(EMPTY_COUNTS);
  const [problems, setProblems] = useState<ImportRowProblem[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  /** The options the last run went with, for what its result says. */
  const [runOptions, setRunOptions] = useState<TOptions | null>(null);

  // What a request loop reads between requests, without re-rendering for it.
  const stopRequested = useRef(false);
  const cancelPreview = useRef(false);
  const activeRun = useRef<{ runId: string; options: TOptions; fileName: string } | null>(null);

  const busy = phase.step === "checking" || phase.step === "importing";
  const importing = phase.step === "importing";

  const reset = useCallback(() => {
    setFile(null);
    setFileError(null);
    setPrepared(null);
    setPhase({ step: "select" });
    setCounts(EMPTY_COUNTS);
    setProblems([]);
    setRequestError(null);
    setRunOptions(null);
    activeRun.current = null;
  }, []);

  const handleOpenChange = (next: boolean) => {
    // An import keeps the dialog: closing it would hide a run still writing.
    if (busy) return;
    onOpenChange(next);
    if (!next) reset();
  };

  const stopBody = useCallback(
    (run: { runId: string; options: TOptions; fileName: string }) =>
      JSON.stringify({
        runId: run.runId,
        dryRun: false,
        chunkIndex: 0,
        stop: true,
        fileName: run.fileName,
        options: run.options,
        headers: [],
        rows: [],
      }),
    [],
  );

  // Leaving mid-import: the browser asks first, and a page that goes anyway
  // tells the route to end the run, so it is recorded as stopped.
  useEffect(() => {
    if (!importing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = () => {
      const run = activeRun.current;
      if (!run) return;
      navigator.sendBeacon?.(
        entity.endpoint,
        new Blob([stopBody(run)], { type: "application/json" }),
      );
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", leave);
    };
  }, [entity.endpoint, importing, stopBody]);

  const pickFile = async (candidate: File | undefined) => {
    if (!candidate) return;
    setRequestError(null);
    setPrepared(null);
    if (!/\.csv$/i.test(candidate.name) && candidate.type !== "text/csv") {
      setFile(null);
      setFileError(t("wrongType"));
      return;
    }
    if (candidate.size > entity.maxFileBytes) {
      setFile(null);
      setFileError(t("fileTooLarge", { size: Math.round(entity.maxFileBytes / (1024 * 1024)) }));
      return;
    }
    setFile(candidate);
    setFileError(null);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void pickFile(event.dataTransfer.files?.[0]);
  };

  async function postChunk(body: Record<string, unknown>) {
    const response = await fetch(entity.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: { counts: ImportCounts; problems: ImportRowProblem[]; finished?: ImportFinished | null };
      error?: string;
      message?: string;
    } | null;
    if (!response.ok || !payload?.success || !payload.data) {
      throw new Error(payload?.error || payload?.message || t("requestFailed"));
    }
    return payload.data;
  }

  /** Read the file and check every row with the route, writing nothing. */
  const runPreview = async () => {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError(t("readFailed"));
      return;
    }
    const { headers, records } = parseCsv(text);
    if (records.length === 0) {
      setFileError(t("emptyFile"));
      return;
    }
    if (records.length > entity.maxRows) {
      setFileError(
        t("tooManyRows", {
          count: records.length.toLocaleString(),
          max: entity.maxRows.toLocaleString(),
        }),
      );
      return;
    }
    const header = entity.checkHeaders(headers);
    if (!header.ok) {
      setFileError(entity.describe(header.error));
      return;
    }

    const ready = prepareFile(file.name, headers, records, header.rowKey, header.warnings);
    setPrepared(ready);
    setRequestError(null);
    cancelPreview.current = false;
    setPhase({ step: "checking", done: 0 });

    const previewRunId = newRunId();
    let total = { ...EMPTY_COUNTS, skip: ready.localProblems.length };
    const found: ImportRowProblem[] = [...ready.localProblems];
    try {
      for (let start = 0, index = 0; start < ready.rows.length; start += entity.chunkSize, index++) {
        if (cancelPreview.current) {
          setPhase({ step: "select" });
          return;
        }
        const rows = ready.rows.slice(start, start + entity.chunkSize);
        const data = await postChunk({
          runId: previewRunId,
          dryRun: true,
          chunkIndex: index,
          fileName: ready.fileName,
          options,
          headers: ready.headers,
          rows,
        });
        total = addCounts(total, data.counts);
        found.push(...data.problems);
        setPhase({ step: "checking", done: Math.min(start + rows.length, ready.rows.length) });
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : t("requestFailed"));
      setPhase({ step: "select" });
      return;
    }
    setCounts(total);
    setProblems(found.sort((a, b) => a.row - b.row));
    setPhase({ step: "preview" });
  };

  /** The same requests for real, one after another, until the file ends or Stop. */
  const runImport = async () => {
    if (!prepared) return;
    const run = { runId: newRunId(), options, fileName: prepared.fileName };
    activeRun.current = run;
    setRunOptions(options);
    stopRequested.current = false;
    setRequestError(null);
    setPhase({ step: "importing", done: 0, stopping: false });

    let total = { ...EMPTY_COUNTS, skip: prepared.localProblems.length };
    const found: ImportRowProblem[] = [...prepared.localProblems];
    let finished: ImportFinished | null = null;
    let failure: string | undefined;
    const chunks = Math.ceil(prepared.rows.length / entity.chunkSize);

    for (let index = 0; index < chunks; index++) {
      if (stopRequested.current) break;
      const start = index * entity.chunkSize;
      const rows = prepared.rows.slice(start, start + entity.chunkSize);
      try {
        const data = await postChunk({
          runId: run.runId,
          dryRun: false,
          chunkIndex: index,
          final: index === chunks - 1,
          // The rows the file itself overruled, so the run's record counts
          // them as skipped, as this dialog does.
          ...(index === 0 ? { heldBack: prepared.localProblems.length } : {}),
          fileName: run.fileName,
          options: run.options,
          headers: prepared.headers,
          rows,
        });
        total = addCounts(total, data.counts);
        found.push(...data.problems);
        if (data.finished) finished = data.finished;
        setCounts(total);
        setPhase((current) =>
          current.step === "importing"
            ? { ...current, done: Math.min(start + rows.length, prepared.rows.length) }
            : current,
        );
      } catch (error) {
        failure = error instanceof Error ? error.message : t("requestFailed");
        break;
      }
    }

    if (!finished) {
      // Stopped, or a request failed: end the run here so it is recorded.
      try {
        const response = await fetch(entity.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: stopBody(run),
        });
        const payload = (await response.json().catch(() => null)) as {
          data?: { finished?: ImportFinished | null };
        } | null;
        finished = payload?.data?.finished ?? { status: "stopped" };
      } catch {
        finished = { status: "stopped" };
      }
    }

    activeRun.current = null;
    setCounts(total);
    setProblems(found.sort((a, b) => a.row - b.row));
    setPhase({ step: "result", finished, failure });
    if (total.create > 0 || total.update > 0) onImported();
  };

  const describeProblem = (problem: ImportRowProblem) =>
    [problem.reason, ...(problem.warnings ?? [])]
      .filter((message): message is ImportMessage => Boolean(message))
      .map((message) => entity.describe(message))
      .join(" ");

  const statusLabel = (status: ImportRowStatus) => t(`status.${status}`);

  const downloadProblems = () => {
    if (!prepared) return;
    const lines = [
      csvLine([t("csv.row"), t("csv.key"), t("csv.result"), t("csv.message")]),
      ...problems.map((problem) =>
        csvLine([problem.row, problem.key ?? "", statusLabel(problem.status), describeProblem(problem)]),
      ),
    ];
    const baseName = prepared.fileName.replace(/\.[^.]+$/, "");
    saveBlob(
      new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }),
      `${baseName}-rows-to-check.csv`,
    );
  };

  const total = prepared?.rows.length ?? 0;
  const progressDone =
    phase.step === "checking" || phase.step === "importing" ? phase.done : 0;
  const percent = total > 0 ? Math.round((progressDone / total) * 100) : 0;
  const showCounts = phase.step === "preview" || phase.step === "result";
  const isResult = phase.step === "result";
  const stopped = isResult && phase.finished?.status === "stopped";

  const countTiles: Array<{ label: string; value: number; tone: string }> = [
    {
      label: isResult ? t("counts.created") : t("counts.toCreate"),
      value: counts.create,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: isResult ? t("counts.updated") : t("counts.toUpdate"),
      value: counts.update,
      tone: "text-sky-600 dark:text-sky-400",
    },
    { label: t("counts.skipped"), value: counts.skip, tone: "text-muted-foreground" },
    {
      label: t("counts.errors"),
      value: counts.error,
      tone: counts.error > 0 ? "text-destructive" : "text-muted-foreground",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader className="min-w-0">
          <DialogTitle>
            {isResult ? (stopped ? t("stoppedTitle") : t("doneTitle")) : phase.step === "preview" ? t("previewTitle") : title}
          </DialogTitle>
          <DialogDescription className="break-words">
            {prepared && phase.step !== "select"
              ? phase.step === "preview"
                ? t("previewDescription", { file: prepared.fileName })
                : prepared.fileName
              : description}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {phase.step === "select" && (
            <>
              {guide}
              <input
                id={inputId}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  void pickFile(event.target.files?.[0]);
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
                    aria-label={t("removeFile")}
                    onClick={() => {
                      setFile(null);
                      setPrepared(null);
                    }}
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
                    {t("dropHint", {
                      rows: entity.maxRows.toLocaleString(),
                      size: Math.round(entity.maxFileBytes / (1024 * 1024)),
                    })}
                  </span>
                </label>
              )}
              {renderOptions(false)}
            </>
          )}

          {(fileError || requestError) && (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 break-words">{fileError || requestError}</p>
            </div>
          )}

          {(phase.step === "checking" || phase.step === "importing") && (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  <span className="truncate">
                    {phase.step === "checking"
                      ? t("checking", { done: progressDone.toLocaleString(), total: total.toLocaleString() })
                      : phase.stopping
                        ? t("stopping")
                        : t("importing", { done: progressDone.toLocaleString(), total: total.toLocaleString() })}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {importing && <p className="text-xs text-muted-foreground">{t("keepOpen")}</p>}
            </div>
          )}

          {showCounts && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {countTiles.map((tile) => (
                <div key={tile.label} className="rounded-lg border px-3 py-3 text-center">
                  <p className={cn("text-2xl font-semibold tabular-nums", tile.tone)}>
                    {tile.value.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tile.label}</p>
                </div>
              ))}
            </div>
          )}

          {isResult && phase.failure && (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 break-words">{t("failedNote", { error: phase.failure })}</p>
            </div>
          )}
          {stopped && <p className="text-sm text-muted-foreground">{t("stoppedNote")}</p>}
          {isResult && renderFinished?.(phase.finished, runOptions ?? options)}

          {phase.step === "preview" && counts.create + counts.update === 0 && (
            <p className="text-sm text-muted-foreground">{t("nothingToImport")}</p>
          )}

          {(phase.step === "preview" || isResult) && prepared && prepared.fileWarnings.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                {prepared.fileWarnings.map((warning) => (
                  <p key={warning.code} className="break-words">
                    {entity.describe(warning)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {(phase.step === "preview" || isResult) && problems.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <p className="text-sm font-medium">
                  {t("problemsTitle", { count: problems.length.toLocaleString() })}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={downloadProblems}>
                  <Download className="h-4 w-4" />
                  {t("downloadProblems")}
                </Button>
              </div>
              <ul className="max-h-64 divide-y overflow-y-auto text-sm">
                {problems.slice(0, VISIBLE_PROBLEMS).map((problem, index) => (
                  <li key={`${problem.row}-${index}`} className="flex gap-3 px-3 py-2">
                    <span className="w-20 shrink-0 font-medium tabular-nums text-muted-foreground">
                      {t("rowLabel", { row: problem.row })}
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      {problem.key ? (
                        <span className="block truncate text-xs text-muted-foreground">{problem.key}</span>
                      ) : null}
                      <span
                        className={cn(
                          "block break-words",
                          problem.status === "error" && "text-destructive",
                        )}
                      >
                        {describeProblem(problem)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {problems.length > VISIBLE_PROBLEMS && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {t("moreProblems", { count: (problems.length - VISIBLE_PROBLEMS).toLocaleString() })}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {phase.step === "select" && (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                disabled={!file || !optionsReady}
                onClick={() => void runPreview()}
              >
                {t("check")}
              </Button>
            </>
          )}
          {phase.step === "checking" && (
            <Button type="button" variant="outline" onClick={() => (cancelPreview.current = true)}>
              {t("cancel")}
            </Button>
          )}
          {phase.step === "preview" && (
            <>
              <Button type="button" variant="outline" onClick={() => setPhase({ step: "select" })}>
                {t("back")}
              </Button>
              <Button
                type="button"
                disabled={counts.create + counts.update === 0}
                onClick={() => void runImport()}
              >
                {t("import")}
              </Button>
            </>
          )}
          {phase.step === "importing" && (
            <Button
              type="button"
              variant="outline"
              disabled={phase.stopping}
              onClick={() => {
                stopRequested.current = true;
                setPhase((current) =>
                  current.step === "importing" ? { ...current, stopping: true } : current,
                );
              }}
            >
              {t("stop")}
            </Button>
          )}
          {isResult && (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                {t("importAnother")}
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t("done")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
