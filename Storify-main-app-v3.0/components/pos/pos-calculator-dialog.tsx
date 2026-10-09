"use client";

import * as React from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CalculatorOperator = "add" | "subtract" | "multiply" | "divide";

type CalculatorHistoryItem = {
  expression: string;
  result: string;
};

type POSCalculatorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const OPERATOR_SYMBOLS: Record<CalculatorOperator, string> = {
  add: "+",
  subtract: "-",
  multiply: "\u00d7",
  divide: "\u00f7",
};

const NUMBER_ROWS = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
];

function parseDisplay(value: string) {
  return Number(value.replace(/,/g, ""));
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "Error";

  const rounded =
    Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const fixed = normalized.toFixed(9).replace(/\.?0+$/, "");

  if (fixed.replace("-", "").replace(".", "").length > 12) {
    return normalized.toExponential(6).replace(/\.?0+e/, "e");
  }

  return fixed;
}

function calculate(left: number, right: number, operator: CalculatorOperator) {
  switch (operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      return right === 0 ? Number.NaN : left / right;
  }
}

export function POSCalculatorDialog({
  open,
  onOpenChange,
}: POSCalculatorDialogProps) {
  const [display, setDisplay] = React.useState("0");
  const [storedValue, setStoredValue] = React.useState<number | null>(null);
  const [pendingOperator, setPendingOperator] =
    React.useState<CalculatorOperator | null>(null);
  const [waitingForOperand, setWaitingForOperand] = React.useState(false);
  const [history, setHistory] = React.useState<CalculatorHistoryItem[]>([]);

  const appendDigit = React.useCallback(
    (digit: string) => {
      setDisplay((current) => {
        if (current === "Error" || waitingForOperand) return digit;
        if (current === "0") return digit;
        if (current.replace("-", "").replace(".", "").length >= 12) {
          return current;
        }
        return `${current}${digit}`;
      });
      setWaitingForOperand(false);
    },
    [waitingForOperand],
  );

  const appendDecimal = React.useCallback(() => {
    setDisplay((current) => {
      if (current === "Error" || waitingForOperand) return "0.";
      if (current.includes(".")) return current;
      return `${current}.`;
    });
    setWaitingForOperand(false);
  }, [waitingForOperand]);

  const clearAll = React.useCallback(() => {
    setDisplay("0");
    setStoredValue(null);
    setPendingOperator(null);
    setWaitingForOperand(false);
  }, []);

  const clearEntry = React.useCallback(() => {
    setDisplay("0");
    setWaitingForOperand(false);
  }, []);

  const chooseOperator = React.useCallback(
    (operator: CalculatorOperator) => {
      const inputValue = parseDisplay(display);

      if (!Number.isFinite(inputValue)) {
        clearAll();
        return;
      }

      if (storedValue !== null && pendingOperator && !waitingForOperand) {
        const nextValue = calculate(storedValue, inputValue, pendingOperator);
        const formatted = formatNumber(nextValue);

        setDisplay(formatted);
        setStoredValue(Number.isFinite(nextValue) ? nextValue : null);
        setPendingOperator(Number.isFinite(nextValue) ? operator : null);
        setWaitingForOperand(true);
        return;
      }

      setStoredValue(inputValue);
      setPendingOperator(operator);
      setWaitingForOperand(true);
    },
    [clearAll, display, pendingOperator, storedValue, waitingForOperand],
  );

  const performCalculation = React.useCallback(() => {
    if (storedValue === null || !pendingOperator) return;

    const inputValue = parseDisplay(display);
    const result = calculate(storedValue, inputValue, pendingOperator);
    const formattedResult = formatNumber(result);
    const expression = `${formatNumber(storedValue)} ${
      OPERATOR_SYMBOLS[pendingOperator]
    } ${formatNumber(inputValue)} =`;

    setDisplay(formattedResult);
    setStoredValue(null);
    setPendingOperator(null);
    setWaitingForOperand(true);

    if (Number.isFinite(result)) {
      setHistory((items) => [
        { expression, result: formattedResult },
        ...items.slice(0, 19),
      ]);
    }
  }, [display, pendingOperator, storedValue]);

  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        appendDigit(event.key);
        return;
      }

      if (event.key === ".") {
        event.preventDefault();
        appendDecimal();
        return;
      }

      if (event.key === "Enter" || event.key === "=") {
        event.preventDefault();
        performCalculation();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        setDisplay((current) =>
          current.length > 1 && current !== "Error" ? current.slice(0, -1) : "0",
        );
        return;
      }

      const operatorByKey: Record<string, CalculatorOperator> = {
        "+": "add",
        "-": "subtract",
        "*": "multiply",
        "/": "divide",
      };
      const operator = operatorByKey[event.key];
      if (operator) {
        event.preventDefault();
        chooseOperator(operator);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    appendDecimal,
    appendDigit,
    chooseOperator,
    onOpenChange,
    open,
    performCalculation,
  ]);

  const previewExpression = React.useMemo(() => {
    if (storedValue === null || !pendingOperator) return "";

    const left = formatNumber(storedValue);
    const symbol = OPERATOR_SYMBOLS[pendingOperator];

    if (waitingForOperand) return `${left} ${symbol}`;
    return `${left} ${symbol} ${display}`;
  }, [display, pendingOperator, storedValue, waitingForOperand]);

  const numberButtonClass =
    "h-11 rounded-md border border-border bg-background text-sm font-semibold text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25";
  const operatorButtonClass =
    "h-11 rounded-md border border-border bg-muted text-sm font-semibold text-foreground shadow-xs transition-colors hover:border-primary/25 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25";
  const clearButtonClass =
    "h-11 rounded-md border border-border bg-muted text-sm font-semibold text-foreground shadow-xs transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 dark:hover:border-red-500/40 dark:hover:bg-red-500/15 dark:hover:text-red-300";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] max-w-[380px] gap-0 overflow-hidden rounded-lg border-border bg-background p-0 text-foreground shadow-2xl sm:max-w-[380px]"
      >
        <div className="flex items-center justify-between px-5 py-4">
          <DialogTitle className="text-base font-semibold text-foreground">
            Calculator
          </DialogTitle>
          <DialogDescription className="sr-only">
            POS calculator with basic operations and recent calculation history.
          </DialogDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Close calculator"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 pb-5">
          <div className="mb-3.5 flex h-16 flex-col items-end justify-center gap-0.5 rounded-md border border-border bg-background px-4 py-2">
            <span className="h-4 max-w-full truncate text-right text-sm font-medium tabular-nums text-muted-foreground">
              {previewExpression}
            </span>
            <span className="max-w-full truncate text-right text-[26px] font-bold leading-none tabular-nums text-foreground">
              {display}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button type="button" className={clearButtonClass} onClick={clearAll}>
              C
            </button>
            <button type="button" className={clearButtonClass} onClick={clearEntry}>
              CE
            </button>
            <button
              type="button"
              className={operatorButtonClass}
              onClick={() => chooseOperator("divide")}
              aria-label="Divide"
            >
              {"\u00f7"}
            </button>
            <button
              type="button"
              className={operatorButtonClass}
              onClick={() => chooseOperator("multiply")}
              aria-label="Multiply"
            >
              {"\u00d7"}
            </button>

            {NUMBER_ROWS[0].map((digit) => (
              <button
                key={digit}
                type="button"
                className={numberButtonClass}
                onClick={() => appendDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              className={operatorButtonClass}
              onClick={() => chooseOperator("subtract")}
              aria-label="Subtract"
            >
              -
            </button>

            {NUMBER_ROWS[1].map((digit) => (
              <button
                key={digit}
                type="button"
                className={numberButtonClass}
                onClick={() => appendDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              className={operatorButtonClass}
              onClick={() => chooseOperator("add")}
              aria-label="Add"
            >
              +
            </button>

            {NUMBER_ROWS[2].map((digit) => (
              <button
                key={digit}
                type="button"
                className={numberButtonClass}
                onClick={() => appendDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              className="h-11 rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              onClick={performCalculation}
              aria-label="Calculate"
            >
              =
            </button>

            <button
              type="button"
              className={cn(numberButtonClass, "col-span-2")}
              onClick={() => appendDigit("0")}
            >
              0
            </button>
            <button
              type="button"
              className={numberButtonClass}
              onClick={appendDecimal}
              aria-label="Decimal"
            >
              .
            </button>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase text-muted-foreground">
              <span>History</span>
              {history.length > 0 ? (
                <button
                  type="button"
                  className="normal-case text-[11px] font-medium text-muted-foreground transition-colors hover:text-red-600 dark:hover:text-red-300"
                  onClick={() => setHistory([])}
                >
                  Clear
                </button>
              ) : null}
            </div>

            {history.length === 0 ? (
              <div className="flex h-12 items-center justify-center text-xs text-muted-foreground">
                No calculations yet
              </div>
            ) : (
              <div className="max-h-[148px] space-y-2 overflow-y-auto pr-1">
                {history.map((item, index) => (
                  <button
                    key={`${item.expression}-${index}`}
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-3 rounded-md bg-muted px-3 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                    onClick={() => {
                      setDisplay(item.result);
                      setWaitingForOperand(true);
                    }}
                  >
                    <span className="truncate">{item.expression}</span>
                    <span className="shrink-0 text-foreground">
                      {item.result}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
