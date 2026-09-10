/**
 * Validation Helper Utilities
 * Provides unified validation for API routes using Zod schemas
 */

import { z, ZodSchema, ZodError } from "zod";
import { NextRequest } from "next/server";
import { ValidationError } from "./errors";

/**
 * Sanitize search string to prevent ReDoS attacks
 * Escapes all regex special characters
 *
 * Every list endpoint that feeds user input into a MongoDB `$regex` must run
 * it through this first (directly, via SafeSearchSchema, or parseListQuery).
 * Scaling note: those case-insensitive unanchored regexes cannot use B-tree
 * indexes — acceptable at current data sizes, but if a collection grows to
 * tens of thousands of documents, switch its search to a $text index
 * (Product, Vendor, Collection, BlogPost, Cart already define one) or Atlas
 * Search rather than tuning the regex.
 */
export function sanitizeSearchString(input: string): string {
  if (!input) return input;
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert Zod errors to a structured error object
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  error.issues.forEach((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "_root";
    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(issue.message);
  });

  return errors;
}

/**
 * Validate request body against a Zod schema
 * @throws ValidationError if validation fails
 */
export async function validateBody<T extends ZodSchema>(
  request: NextRequest,
  schema: T
): Promise<z.infer<T>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ValidationError({ _root: ["Invalid JSON in request body"] });
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    throw new ValidationError(formatZodErrors(result.error));
  }

  return result.data;
}

/**
 * Like `validateBody`, but an empty, missing or malformed JSON body validates
 * as `{}` instead of failing — for endpoints whose fields are all optional and
 * whose callers may legitimately send nothing (session revocation, checkout
 * recovery, order tracking). Presence rules stay in the route so its own
 * error messages survive.
 */
export async function validateOptionalBody<T extends ZodSchema>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const body: unknown = await request.json().catch(() => ({}));
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new ValidationError(formatZodErrors(result.error));
  }
  return result.data;
}

/**
 * Drop keys the client did not actually send from a parsed payload.
 *
 * `Schema.partial()` makes every key optional but does **not** remove the
 * `.default()` attached to it, so parsing `{ name: "x" }` against
 * `UpdateProductSchema` returns `status: "draft"`, `variants: []`,
 * `images: []`, `featured: false`, … — values the caller never sent. Update
 * routes spread that result into `$set`, so a partial edit silently unpublished
 * the product and wiped its variants, options, images and stock.
 *
 * Filtering after parsing (rather than stripping the defaults from the schema)
 * keeps cross-field refinements working: they still see the fully defaulted
 * object, only the write is narrowed to what was submitted.
 *
 * Nested defaults inside an object the caller *did* send are still applied —
 * partial updates of sub-documents remain all-or-nothing.
 */
export function pickSubmittedKeys<T extends Record<string, unknown>>(
  rawBody: unknown,
  parsed: T,
): Partial<T> {
  if (
    typeof rawBody !== "object" ||
    rawBody === null ||
    Array.isArray(rawBody)
  ) {
    return parsed;
  }

  const submitted = new Set(Object.keys(rawBody));
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => submitted.has(key)),
  ) as Partial<T>;
}

/**
 * Validate a partial (PATCH/PUT) request body.
 *
 * Same as `validateBody`, but the result contains only the keys present in the
 * request — see `pickSubmittedKeys` for why that matters. Use this for every
 * `Update*Schema` (i.e. any `.partial()` schema) whose result is written with
 * `$set` or `Object.assign`.
 */
export async function validatePartialBody<T extends ZodSchema>(
  request: NextRequest,
  schema: T
): Promise<Partial<z.infer<T>>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ValidationError({ _root: ["Invalid JSON in request body"] });
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    throw new ValidationError(formatZodErrors(result.error));
  }

  return pickSubmittedKeys(body, result.data as Record<string, unknown>) as Partial<
    z.infer<T>
  >;
}

/**
 * Page-side counterpart of `validateQuery`.
 *
 * List screens are rendered by a server component *and* served by an API
 * route, and the two must read the same query string the same way — so both
 * parse it with the same Zod schema rather than each hand-rolling defaults.
 *
 * The difference is what happens to junk: a request with a bad param is a
 * client error and `validateQuery` rejects it, but a bad param typed into the
 * address bar should still render the list. Invalid input here falls back to
 * the schema's defaults instead of throwing an error page.
 */
export function parsePageQuery<T extends ZodSchema>(
  searchParams: Record<string, string | string[] | undefined>,
  schema: T,
): z.infer<T> {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) params[key] = value;
  }

  const result = schema.safeParse(params);
  if (result.success) return result.data;

  // Drop the offending params and fall back to the schema's own defaults.
  const defaults = schema.safeParse({});
  if (defaults.success) return defaults.data;
  throw new ValidationError(formatZodErrors(result.error));
}

/**
 * Validate query parameters against a Zod schema
 * @throws ValidationError if validation fails
 */
export function validateQuery<T extends ZodSchema>(
  request: NextRequest,
  schema: T
): z.infer<T> {
  const searchParams = request.nextUrl.searchParams;
  const params: Record<string, string | string[]> = {};

  // Convert URLSearchParams to object
  searchParams.forEach((value, key) => {
    const existing = params[key];
    if (existing) {
      // Handle array values
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        params[key] = [existing, value];
      }
    } else {
      params[key] = value;
    }
  });

  const result = schema.safeParse(params);

  if (!result.success) {
    throw new ValidationError(formatZodErrors(result.error));
  }

  return result.data;
}

/**
 * Validate MongoDB ObjectId format
 */
export function isValidObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}
