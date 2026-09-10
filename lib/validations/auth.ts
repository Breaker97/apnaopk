import { z } from "zod";

/**
 * Login and registration schemas.
 *
 * Kept apart from `./index` because the auth forms run in the browser — and
 * sit inside the storefront header's account drawer — so importing the barrel
 * dragged every admin, order and return schema plus their lib dependencies into
 * every storefront page. Server code may keep importing from `@/lib/validations`,
 * which re-exports this module.
 */

/**
 * No `role` field on purpose. The server declares `role`/`roles`/`status` as
 * non-input fields (see lib/auth.ts), so anything a client sends is discarded —
 * carrying one here only invites a future caller to send it and assume it
 * counts.
 */
export const RegisterSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase()),
  // Floor only — the admin's configured length and complexity rules are
  // enforced server-side in `checkPasswordPolicy`.
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
