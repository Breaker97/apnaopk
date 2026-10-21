import "server-only";

import { audit, type AuditContext } from "@/lib/audit";
import type { InvoiceTemplate } from "./types";

/**
 * Activity-log rows for template management, like other settings writes. A
 * row records what a person would look for — the name, category, size, how
 * many elements, the default flag and the version — never the design itself:
 * it is long, and the template is where it is kept. `audit()` never throws,
 * so none of these can fail the write that called it.
 */

const CATEGORY_NAMES = { online: "online invoice", pos: "POS receipt", sticker: "sticker" } as const;

export function templateSnapshot(template: InvoiceTemplate): Record<string, unknown> {
  return {
    name: template.name,
    category: template.category,
    isDefault: template.isDefault,
    ...(template.presetKey ? { presetKey: template.presetKey } : {}),
    locale: template.locale,
    size: `${template.canvas.preset} (${template.canvas.widthMm} × ${template.canvas.heightMm} mm)`,
    elements: template.elements.length,
    version: template.version,
  };
}

const kind = (template: InvoiceTemplate) => `${CATEGORY_NAMES[template.category]} template`;

function row(template: InvoiceTemplate) {
  return { resource: "invoiceTemplate" as const, resourceId: template.id, resourceName: template.name };
}

export async function auditTemplateCreated(
  context: AuditContext,
  template: InvoiceTemplate,
  how: "blank" | "preset" | "design" | "copy",
) {
  const from = { blank: "blank", preset: `from the ${template.presetKey} preset`, design: "from a design", copy: "as a copy" }[how];
  return audit(context, {
    action: "CREATE",
    ...row(template),
    changes: { after: templateSnapshot(template), summary: `Created ${kind(template)} "${template.name}" ${from}` },
  });
}

export async function auditTemplateUpdated(context: AuditContext, before: InvoiceTemplate, after: InvoiceTemplate) {
  const fields = [
    ...(before.name !== after.name ? ["name"] : []),
    ...(JSON.stringify([before.locale, before.canvas, before.format, before.elements]) !==
    JSON.stringify([after.locale, after.canvas, after.format, after.elements])
      ? ["design"]
      : []),
  ];
  if (fields.length === 0) return null;
  return audit(context, {
    action: "UPDATE",
    ...row(after),
    changes: {
      before: templateSnapshot(before),
      after: templateSnapshot(after),
      fields,
      summary:
        fields.includes("name") && !fields.includes("design")
          ? `Renamed ${kind(after)} "${before.name}" to "${after.name}"`
          : `Saved ${kind(after)} "${after.name}" (version ${after.version})`,
    },
  });
}

export async function auditTemplateRestored(context: AuditContext, before: InvoiceTemplate, after: InvoiceTemplate) {
  return audit(context, {
    action: "UPDATE",
    ...row(after),
    changes: {
      before: templateSnapshot(before),
      after: templateSnapshot(after),
      fields: ["design"],
      summary: `Restored ${kind(after)} "${after.name}" to its ${after.presetKey} preset`,
    },
  });
}

export async function auditTemplateDeleted(context: AuditContext, template: InvoiceTemplate) {
  return audit(context, {
    action: "DELETE",
    ...row(template),
    changes: {
      before: templateSnapshot(template),
      summary: template.isDefault
        ? `Deleted ${kind(template)} "${template.name}", the default — ${CATEGORY_NAMES[template.category]}s print the standard output again`
        : `Deleted ${kind(template)} "${template.name}"`,
    },
  });
}

export async function auditTemplateDefault(
  context: AuditContext,
  template: InvoiceTemplate,
  replaced: InvoiceTemplate | null = null,
) {
  return audit(context, {
    action: "STATUS_CHANGE",
    ...row(template),
    changes: {
      before: { isDefault: !template.isDefault },
      after: { isDefault: template.isDefault },
      fields: ["isDefault"],
      summary: template.isDefault
        ? `Set "${template.name}" as the default ${kind(template)}${replaced ? ` (was "${replaced.name}")` : ""}`
        : `Removed "${template.name}" as the default ${kind(template)} — the standard output prints again`,
    },
  });
}
