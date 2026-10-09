import type * as z from "zod";
import { MobileApiError } from "./errors";

/**
 * Turning a request into a handler's `input`.
 *
 * A query string carries only text, while the contract describes a query as
 * the app means it (`limit` a number, `onSale` a boolean). Rather than put
 * `z.coerce` into the contract, which would describe something the app does
 * not send, the query is read by the schema's own shape: each key is turned
 * into the type its field expects, and the schema then judges it as usual.
 */

type Def = {
  type: string;
  innerType?: z.ZodType;
  element?: z.ZodType;
  shape?: Record<string, z.ZodType>;
};

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

/** The field's type under optional/nullable/default wrappers. */
function baseDef(schema: z.ZodType): Def {
  let def = defOf(schema);
  while (def.innerType && ["optional", "nullable", "default", "prefault", "readonly", "catch"].includes(def.type)) {
    def = defOf(def.innerType);
  }
  return def;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function coerceScalar(value: string, type: string): unknown {
  if ((type === "number" || type === "int") && NUMBER.test(value)) return Number(value);
  if (type === "boolean") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return value;
}

/** The query string as the input schema reads it. Unknown keys are left out. */
export function queryToInput(schema: z.ZodType, params: URLSearchParams): Record<string, unknown> {
  const def = baseDef(schema);
  if (def.type !== "object" || !def.shape) return Object.fromEntries(params);
  const input: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(def.shape)) {
    if (!params.has(key)) continue;
    const fieldDef = baseDef(field);
    if (fieldDef.type === "array" && fieldDef.element) {
      const elementType = baseDef(fieldDef.element).type;
      input[key] = params
        .getAll(key)
        .flatMap((value) => value.split(","))
        .filter(Boolean)
        .map((value) => coerceScalar(value, elementType));
    } else {
      input[key] = coerceScalar(params.get(key) ?? "", fieldDef.type);
    }
  }
  return input;
}

/** Field → messages, the `errors` of a VALIDATION_ERROR. */
function issuesToErrors(error: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_error";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

export function parseInput(schema: z.ZodType, raw: unknown): unknown {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const errors = issuesToErrors(parsed.error);
  throw new MobileApiError(
    400,
    "VALIDATION_ERROR",
    `Validation failed: ${Object.keys(errors).join(", ")}`,
    { errors },
  );
}

/**
 * A `multipart/form-data` body (a file upload), as one value per field: the
 * file as a `File`, any other field as text. Refused once it passes
 * `maxBytes`, at once by its declared length or as soon as the bytes read
 * pass it, so an oversized upload is never held in memory whole: 413 with the
 * reason UPLOAD_TOO_LARGE.
 */
export async function readFormBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const tooLarge = () =>
    new MobileApiError(413, "VALIDATION_ERROR", `The upload is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.`, {
      reason: "UPLOAD_TOO_LARGE",
    });
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "Send the file as multipart/form-data.", {
      reason: "UPLOAD_MISSING",
    });
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  // Read by hand rather than piped, so a body that runs over is cancelled at
  // once and nothing is left reading it.
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new MobileApiError(400, "VALIDATION_ERROR", "The request body is not valid multipart/form-data.", {
      reason: "UPLOAD_MISSING",
    });
  }
  const fields: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (!(key in fields)) fields[key] = value;
  }
  return fields;
}

/** The largest JSON body a write may send. */
const MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const tooLarge = () => new MobileApiError(400, "VALIDATION_ERROR", "The request body is too large.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader?.releaseLock();
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MobileApiError(400, "VALIDATION_ERROR", "The request body is not valid JSON.");
  }
}
