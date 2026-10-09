/**
 * The fields of a request to /api/auth, read the way Better Auth's router
 * (better-call `getBody`) reads them, from a clone so the original stream
 * stays intact for Better Auth.
 *
 * The lockout and the password policy check the body before Better Auth sees
 * it, so they must see what Better Auth will see. Reading only JSON let a
 * form-encoded sign-in (which `/sign-in/email` and `/sign-up/email` accept)
 * walk past both: a locked account signed in, a wrong password went
 * uncounted, a weak password was accepted.
 *
 * Null when the body is not one Better Auth turns into fields — it then
 * refuses the request itself.
 */

const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i;

export async function readAuthRequestBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (!request.body) return null;

  try {
    if (JSON_CONTENT_TYPE.test(contentType)) {
      // `Request.json()` decodes as UTF-8 and drops a leading BOM, as Better
      // Auth's own read does.
      const body: unknown = await request.clone().json();
      return body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    }
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.clone().formData();
      const fields: Record<string, unknown> = {};
      form.forEach((value, key) => {
        fields[key] = value;
      });
      return fields;
    }
  } catch {
    // Unreadable: Better Auth answers it with its own 400.
    return null;
  }
  return null;
}
