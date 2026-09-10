import type { z } from "zod";

const FIELD_LABELS: Record<string, string> = {
  name: "Menu name",
  handle: "Handle",
  location: "Location",
  description: "Description",
  items: "Menu items",
  label: "Link label",
  url: "URL",
  type: "Link type",
  target: "Open in",
  icon: "Icon",
  image: "Image",
  badge: "Badge text",
  badgeColor: "Badge color",
  isFeatured: "Right promo panel",
  isMegaColumn: "Mega column",
  columnTitle: "Column title",
  children: "Child items",
};

function fieldLabel(field: string) {
  return FIELD_LABELS[field] || field;
}

function formatPath(path: PropertyKey[]) {
  if (path.length === 0) return "Menu";

  const parts: string[] = [];

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const previous = path[index - 1];

    if (segment === "items") {
      if (!parts.includes("Menu items")) parts.push("Menu items");
      continue;
    }

    if (segment === "children") {
      continue;
    }

    if (typeof segment === "number") {
      const label = previous === "children" ? "Child" : "Item";
      parts.push(`${label} ${segment + 1}`);
      continue;
    }

    parts.push(fieldLabel(String(segment)));
  }

  return parts.join(" > ");
}

function getIssueValue(issue: z.core.$ZodIssue, key: string) {
  return (issue as unknown as Record<string, unknown>)[key];
}

function formatIssueMessage(issue: z.core.$ZodIssue) {
  const field = issue.path.at(-1);
  const fieldName = typeof field === "string" ? fieldLabel(field).toLowerCase() : "value";

  if (issue.code === "too_small") {
    const minimum = getIssueValue(issue, "minimum");
    if (field === "label") return "Add a link label before saving.";
    if (field === "name") return "Add a menu name before saving.";
    if (typeof minimum === "number") {
      return `Use at least ${minimum} characters for ${fieldName}.`;
    }
    return `Add a valid ${fieldName}.`;
  }

  if (issue.code === "too_big") {
    const maximum = getIssueValue(issue, "maximum");
    if (typeof maximum === "number") {
      return `Keep ${fieldName} under ${maximum} characters.`;
    }
    return `${fieldName} is too long.`;
  }

  if (issue.code === "invalid_value") {
    if (field === "location") {
      return "Choose a valid menu location.";
    }
    if (field === "type") {
      return "Choose a valid link type.";
    }
    if (field === "target") {
      return "Choose where this link should open.";
    }
    return `Choose a valid ${fieldName}.`;
  }

  if (issue.code === "invalid_type") {
    if (field === "children") {
      return "Child items must be saved as a list.";
    }
    if (typeof field === "number") {
      return "This menu item is damaged. Remove it and add it again.";
    }
    return `${fieldLabel(String(field))} has an invalid value.`;
  }

  return issue.message;
}

export function formatMenuValidationErrors(error: z.ZodError) {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = formatPath(issue.path);
    errors[key] = [...(errors[key] || []), formatIssueMessage(issue)];
  }

  return errors;
}
