"use client";

import { type ComponentProps, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {fields.map((field) => {
              const fieldId = `input-dialog-${field.name}`;
              const error = errors[field.name];

              return (
                <div key={field.name} className="grid gap-2">
                  <Label id={`${fieldId}-label`} htmlFor={field.options ? undefined : fieldId}>
                    {field.label}
                  </Label>
                  {field.options ? (
                    <RadioGroup
                      id={fieldId}
                      aria-labelledby={`${fieldId}-label`}
                      value={values[field.name] || ""}
                      onValueChange={(value) => updateValue(field.name, value)}
                      aria-invalid={Boolean(error)}
                      disabled={loading}
                      className="gap-2"
                    >
                      {field.options.map((option) => {
                        const optionId = `${fieldId}-${option.value}`;
                        return (
                          <div
                            key={option.value}
                            className="flex items-start gap-3 rounded-md border p-3"
                          >
                            <RadioGroupItem
                              id={optionId}
                              value={option.value}
                              className="mt-0.5"
                            />
                            <div className="grid gap-1">
                              <Label
                                htmlFor={optionId}
                                className="font-normal leading-snug"
                              >
                                {option.label}
                              </Label>
                              {option.description ? (
                                <p className="text-xs text-muted-foreground">
                                  {option.description}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </RadioGroup>
                  ) : field.multiline ? (
                    <Textarea
                      id={fieldId}
                      value={values[field.name] || ""}
                      onChange={(event) =>
                        updateValue(field.name, event.target.value)
                      }
                      placeholder={field.placeholder}
                      required={field.required}
                      rows={field.rows}
                      aria-invalid={Boolean(error)}
                      disabled={loading}
                    />
                  ) : (
                    <Input
                      id={fieldId}
                      type={field.type || "text"}
                      inputMode={field.inputMode}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={values[field.name] || ""}
                      onChange={(event) =>
                        updateValue(field.name, event.target.value)
                      }
                      placeholder={field.placeholder}
                      required={field.required}
                      aria-invalid={Boolean(error)}
                      disabled={loading}
                    />
                  )}
                  {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <DialogFooter>
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
