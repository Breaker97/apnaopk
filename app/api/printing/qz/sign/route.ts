import { createSign } from "node:crypto";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { canAccessPOS } from "@/lib/access/rbac";

/**
 * QZ Tray request signing.
 *
 * qz-tray hashes `{call, params, timestamp}` with SHA-256 and hands us only the
 * hex digest, so the server cannot inspect what it is signing — which makes
 * this endpoint an RSA signing oracle for whoever can reach it. Three things
 * keep that contained:
 *
 *   1. POS access, not merely "some vendor-ish role". A workstation trusting
 *      this store's QZ certificate executes whatever it signs, so the caller
 *      must be someone the admin actually granted point-of-sale rights.
 *   2. The payload must look exactly like the digest qz-tray produces.
 *      Otherwise the route doubles as a generic signing service for any other
 *      protocol that accepts an RSA-SHA512 signature over attacker-chosen
 *      bytes.
 *   3. A per-user rate limit, since a real session signs only a handful of
 *      requests per print job.
 */
const SignSchema = z.object({
  // qz-tray 2.x: lowercase SHA-256 hex of the stringified call object.
  request: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 hex digest from QZ Tray"),
});

function privateKey() {
  return (process.env.QZ_TRAY_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
}

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    if (!(await canAccessPOS(session.user))) {
      throw new AuthorizationError();
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "printing:qz:sign",
      "moderate",
      session.user.role,
    );

    const key = privateKey();
    if (!key) {
      throw new ValidationError(
        "QZ Tray signing is not configured. Add QZ_TRAY_PRIVATE_KEY.",
      );
    }
    const body = await validateBody(request, SignSchema);
    const signer = createSign("RSA-SHA512");
    signer.update(body.request, "utf8");
    signer.end();
    return Response.json({ signature: signer.sign(key, "base64") });
  },
);
