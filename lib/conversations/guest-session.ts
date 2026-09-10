import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";

export const CHAT_GUEST_COOKIE = "chat_guest";
const CHAT_GUEST_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export function createChatGuestToken() {
  return randomBytes(32).toString("base64url");
}

export function hashChatGuestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function attachChatGuestCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: CHAT_GUEST_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHAT_GUEST_MAX_AGE_SECONDS,
  });
  return response;
}
