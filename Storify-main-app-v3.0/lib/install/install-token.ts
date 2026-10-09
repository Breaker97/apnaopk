import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { AuthorizationError } from "@/lib/api/errors";
import { INSTALL_TOKEN_HEADER } from "./payload";

/**
 * Proof that whoever runs the installer owns the server.
 *
 * A fresh deployment has no admin, and the installer makes one — for whoever
 * opens it first. Between the deploy and the owner's first visit, anyone who
 * found the address could take the store, and the storage test would reach
 * any host they named from inside the server's network. The owner sets
 * INSTALL_TOKEN in .env, the wizard asks for it, and every install step that
 * writes or reaches out refuses without it.
 */

const INSTALL_TOKEN_MIN_LENGTH = 32;

function configuredToken(): string {
  return process.env.INSTALL_TOKEN?.trim() ?? "";
}

/** null when INSTALL_TOKEN is usable; otherwise what the owner must fix. */
export function installTokenProblem(): string | null {
  const token = configuredToken();
  if (!token) {
    return "INSTALL_TOKEN is not set. Add a random value of at least 32 characters to .env — for example the output of `openssl rand -hex 32` — then restart the app.";
  }
  if (token.length < INSTALL_TOKEN_MIN_LENGTH) {
    return `INSTALL_TOKEN is ${token.length} characters. Use at least ${INSTALL_TOKEN_MIN_LENGTH}, then restart the app.`;
  }
  return null;
}

/** Compared as SHA-256 digests, so the check takes the same time for any input. */
export function isInstallTokenValid(candidate: string | null | undefined): boolean {
  if (installTokenProblem()) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(
    digest(String(candidate ?? "").trim()),
    digest(configuredToken()),
  );
}

export function assertInstallToken(request: Request): void {
  if (!isInstallTokenValid(request.headers.get(INSTALL_TOKEN_HEADER))) {
    throw new AuthorizationError(
      "The installation token does not match INSTALL_TOKEN in .env.",
    );
  }
}
