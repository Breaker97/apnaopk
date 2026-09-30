"use client";

import { type ComponentProps, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

export type InputDialogValues = Record<string, string>;

export interface InputDialogField {
  name: string;
  label: string;
  placeholder?: string;
  type?: ComponentProps<"input">["type"];
  inputMode?: ComponentProps<"input">["inputMode"];
  min?: number | string;
  max?: number | string;
  step?: number | string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  /**
   * A choice between a few options, shown as radio buttons; the field's value
   * is the chosen option's `value`.
   */
  options?: Array<{ value: string; label: string; description?: string }>;
  /** A single tick box beside `label`; the field's value is "yes" or "no". */
  checkbox?: boolean;
  /** A quiet line under the field, for what it will do beyond the obvious. */
  hint?: string;
  /** Short text after a grouped input, such as "/ 3" for the most it takes. */
  suffix?: string;
  /**
   * Small inputs that belong together — one per order line, say — listed in
   * one box, each label on the left and its input on the right. A question
   * and a full-width box per line ran a long order off the screen. The
   * group's own `name` only keys it; its `label` heads the list.
   */
  group?: InputDialogField[];
}

interface InputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: InputDialogField[];
  values: InputDialogValues;
  onValuesChange: (values: InputDialogValues) => void;
  onSubmit: (values: InputDialogValues) => void;
  submitText?: string;
  cancelText?: string;
  submitVariant?: ButtonVariant;
  loading?: boolean;
  errors?: Record<string, string | undefined>;
}

const fieldId = (name: string) => `input-dialog-${name}`;
const errorId = (name: string) => `input-dialog-${name}-error`;

export function InputDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  values,
  onValuesChange,
  onSubmit,
  submitText = "Submit",
  cancelText = "Cancel",
  submitVariant = "default",
  loading = false,
  errors = {},
}: InputDialogProps) {
  const updateValue = (name: string, value: string) => {
    onValuesChange({ ...values, [name]: value });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(values);
  };

  // An error for a field that is not on screen (the amount of a refund whose
  // amount is fixed, say) is still said, beside the buttons — otherwise the
  // dialog just refuses to close with nothing to show why.
  const shownNames = new Set(
    fields.flatMap((field) => [
      field.name,
      ...(field.group || []).map((row) => row.name),
    ]),
  );
  const formError = Object.entries(errors)
    .filter(([name, message]) => message && !shownNames.has(name))
    .map(([, message]) => message)
    .join(" ");

  const renderError = (name: string, className?: string) =>
    errors[name] ? (
      <p
        id={errorId(name)}
        className={cn("text-sm text-destructive", className)}
      >
        {errors[name]}
      </p>
    ) : null;

  const renderHint = (field: InputDialogField) =>
    field.hint ? (
      <p className="text-xs leading-relaxed text-muted-foreground">{field.hint}</p>
    ) : null;

  const renderInput = (field: InputDialogField, className?: string) => (
    <Input
      id={fieldId(field.name)}
      type={field.type || "text"}
      inputMode={field.inputMode}
      min={field.min}
      max={field.max}
      step={field.step}
      value={values[field.name] || ""}
      onChange={(event) => updateValue(field.name, event.target.value)}
      placeholder={field.placeholder}
      required={field.required}
      aria-invalid={Boolean(errors[field.name])}
      aria-describedby={errors[field.name] ? errorId(field.name) : undefined}
      disabled={loading}
      className={className}
    />
  );

  const renderField = (field: InputDialogField) => {
    const id = fieldId(field.name);
    const error = errors[field.name];

    if (field.checkbox) {
      return (
        <div key={field.name} className="grid gap-2">
          <label
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-3 text-sm leading-snug",
              loading && "cursor-not-allowed opacity-60",
            )}
          >
            <Checkbox
              id={id}
              checked={values[field.name] === "yes"}
              onCheckedChange={(checked) =>
                updateValue(field.name, checked ? "yes" : "no")
              }
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId(field.name) : undefined}
              disabled={loading}
              className="mt-0.5"
            />
            {field.label}
          </label>
          {renderHint(field)}
          {renderError(field.name)}
        </div>
      );
    }

    if (field.group) {
      const withSuffix = field.group.some((row) => row.suffix);
      return (
        <div key={field.name} className="grid gap-2">
          <p id={`${id}-label`} className="text-sm leading-none font-medium">
            {field.label}
          </p>
          {/* One grid, each row a subgrid of it, so the inputs line up in a
              column whatever the length of the name or the suffix. */}
          <div
            role="group"
            aria-labelledby={`${id}-label`}
            className={cn(
              "grid gap-x-3 rounded-lg border",
              withSuffix
                ? "grid-cols-[minmax(0,1fr)_auto_auto]"
                : "grid-cols-[minmax(0,1fr)_auto]",
            )}
          >
            {field.group.map((row, index) => (
              <div
                key={row.name}
                className={cn(
                  "col-span-full grid grid-cols-subgrid items-center gap-y-1.5 px-3.5 py-2.5",
                  index > 0 && "border-t",
                )}
              >
                <Label
                  htmlFor={fieldId(row.name)}
                  className="block font-normal leading-snug break-words"
                >
                  {row.label}
                </Label>
                {renderInput(row, "h-8 w-20 text-right tabular-nums")}
                {withSuffix ? (
                  <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {row.suffix}
                  </span>
                ) : null}
                {renderError(row.name, "col-span-full text-xs")}
              </div>
            ))}
          </div>
          {renderHint(field)}
        </div>
      );
    }

    return (
      <div key={field.name} className="grid gap-2">
        <Label id={`${id}-label`} htmlFor={field.options ? undefined : id}>
          {field.label}
        </Label>
        {field.options ? (
          // One box with a hairline between the choices, not a card per
          // choice: a stack of bordered cards read as clutter.
          <RadioGroup
            id={id}
            aria-labelledby={`${id}-label`}
            value={values[field.name] || ""}
            onValueChange={(value) => updateValue(field.name, value)}
            aria-invalid={Boolean(error)}
            disabled={loading}
            className="gap-0 overflow-hidden rounded-lg border"
          >
            {field.options.map((option, index) => {
              const optionId = `${id}-${option.value}`;
              const chosen = values[field.name] === option.value;
              return (
                <label
                  key={option.value}
                  htmlFor={optionId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 px-3.5 py-3 transition-colors",
                    index > 0 && "border-t",
                    chosen ? "bg-primary/5" : "hover:bg-muted/50",
                    loading && "cursor-not-allowed opacity-60",
                  )}
                >
                  <RadioGroupItem
                    id={optionId}
                    value={option.value}
                    className="mt-0.5"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm leading-snug">{option.label}</span>
                    {option.description ? (
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        ) : field.multiline ? (
          <Textarea
            id={id}
            value={values[field.name] || ""}
            onChange={(event) => updateValue(field.name, event.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            rows={field.rows}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId(field.name) : undefined}
            disabled={loading}
          />
        ) : (
          renderInput(field)
        )}
        {renderHint(field)}
        {renderError(field.name)}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The title and the buttons stay put and the fields scroll between
          them. The order refund form ran off the top and the bottom of a
          laptop screen, with its title and Confirm button out of reach. */}
      <DialogContent className="flex max-h-[min(92dvh,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="shrink-0 pt-6 pr-12 pb-3 pl-4 text-left sm:pl-6">
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="scrollbar-visible min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-6 sm:px-6">
            <div className="grid gap-5">{fields.map(renderField)}</div>
          </div>

          <DialogFooter className="shrink-0 border-t px-4 py-4 sm:px-6">
            {formError ? (
              <p
                role="alert"
                className="order-last text-sm text-destructive sm:order-first sm:mr-auto sm:self-center"
              >
                {formError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {cancelText}
            </Button>
            <Button type="submit" variant={submitVariant} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {submitText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
