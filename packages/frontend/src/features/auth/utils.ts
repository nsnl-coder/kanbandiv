import { TRPCClientError } from "@trpc/client";
import { AuthError } from "shared";
import type { AppRouter } from "backend/src/trpc/router.js";
import { withTraceRef } from "../../lib/trpc";

const MESSAGES: Record<AuthError, string> = {
  [AuthError.EMAIL_TAKEN]: "That email is already registered.",
  [AuthError.INVALID_OTP]: "Invalid or expired code.",
  [AuthError.ALREADY_VERIFIED]: "This email is already verified.",
  [AuthError.INVALID_CREDENTIALS]: "Invalid credentials.",
  [AuthError.EMAIL_NOT_VERIFIED]: "Your email is not verified yet.",
  [AuthError.ACCOUNT_LOCKED]: "Account temporarily locked. Try again later.",
  [AuthError.INVALID_REFRESH_TOKEN]: "Your session expired. Please log in again.",
  [AuthError.RATE_LIMITED]: "Too many requests. Please wait and try again.",
  [AuthError.EMAIL_SEND_FAILED]: "Couldn't send the email. Please try again.",
  [AuthError.OAUTH_FAILED]: "Google sign-in failed. Please try again.",
  [AuthError.SESSION_EXPIRED]: "Your session expired. Please log in again.",
};

// Maps an `?error=` code (set by the Google OAuth callback redirect) to a
// message. `ref` is the traceId the callback appends as `?ref=`; shown so users
// can quote it when reporting a failed sign-in.
export function oauthErrorMessage(code: string, ref?: string | null): string {
  if (code === AuthError.EMAIL_NOT_VERIFIED) {
    return "An account with this email already exists. Log in with your password first.";
  }
  const base = MESSAGES[AuthError.OAUTH_FAILED];
  return ref ? `${base} (Ref: ${ref})` : base;
}

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
  if (key === AuthError.EMAIL_SEND_FAILED) return withTraceRef(MESSAGES[key], err);
  if (key) return MESSAGES[key];
  if (err instanceof TRPCClientError) {
    return withTraceRef("Something went wrong. Please try again.", err);
  }
  return "Connection error, try again.";
}
