import { withApi } from "@/lib/api/handler";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";

function envPem(name: "QZ_TRAY_CERTIFICATE" | "QZ_TRAY_PRIVATE_KEY") {
  return (process.env[name] || "").replace(/\\n/g, "\n").trim();
}

export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    // Same audience as the signing route it pairs with — only callers the
    // admin granted POS rights ever drive a QZ Tray workstation.
    if (!(await canAccessPOS(session.user))) {
      throw new AuthorizationError();
    }
    const certificate = envPem("QZ_TRAY_CERTIFICATE");
    if (!certificate) {
      throw new ValidationError(
        "QZ Tray is not configured. Add QZ_TRAY_CERTIFICATE and QZ_TRAY_PRIVATE_KEY.",
      );
    }
    return new Response(certificate, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, private",
      },
    });
  },
);
