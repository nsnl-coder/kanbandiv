import { TRPCClientError } from "@trpc/client";
import { AuthError } from "shared";
import type { AppRouter } from "backend/src/trpc/router.js";

const MESSAGES: Record<AuthError, string> = {
  [AuthError.EMAIL_TAKEN]: "That email is already registered.",
  [AuthError.INVALID_OTP]: "Invalid or expired code.",
  [AuthError.ALREADY_VERIFIED]: "This email is already verified.",
  [AuthError.INVALID_CREDENTIALS]: "Invalid credentials.",
  [AuthError.EMAIL_NOT_VERIFIED]: "Your email is not verified yet.",
  [AuthError.ACCOUNT_LOCKED]: "Account temporarily locked. Try again later.",
  [AuthError.INVALID_REFRESH_TOKEN]: "Your session expired. Please log in again.",
  [AuthError.RATE_LIMITED]: "Too many requests. Please wait and try again.",
  [AuthError.SESSION_EXPIRED]: "Your session expired. Please log in again.",
};

export function authErrorKey(err: unknown): AuthError | null {
  if (err instanceof TRPCClientError) {
    const msg = (err as TRPCClientError<AppRouter>).message;
    if (msg && msg in MESSAGES) return msg as AuthError;
    if (err.data?.code === "TOO_MANY_REQUESTS") return AuthError.RATE_LIMITED;
  }
  return null;
}

export function authErrorMessage(err: unknown): string {
  const key = authErrorKey(err);
  if (key) return MESSAGES[key];
  if (err instanceof TRPCClientError) return "Something went wrong. Please try again.";
  return "Connection error, try again.";
}
