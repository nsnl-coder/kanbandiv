import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AuthError,
  changePasswordInput,
  forgotPasswordInput,
  impersonateInput,
  loginInput,
  logoutInput,
  okSchema,
  publicUserSchema,
  refreshInput,
  registerInput,
  resendVerifyOtpInput,
  resetPasswordInput,
  verifyEmailInput,
} from "shared";
import { env } from "../../config/env.config.js";
import {
  protectedProcedure,
  publicProcedure,
  rateLimitedProcedure,
  router,
  superuserProcedure,
} from "../../trpc/trpc.js";
import type { Context } from "../../trpc/context.js";
import * as auth from "./auth.service.js";

// Per-IP limits (per minute) on sensitive endpoints.
const registerProc = rateLimitedProcedure(5);
const loginProc = rateLimitedProcedure(10);
const verifyProc = rateLimitedProcedure(10);
const resendProc = rateLimitedProcedure(5);
const refreshProc = rateLimitedProcedure(20);
const forgotProc = rateLimitedProcedure(5);
const resetProc = rateLimitedProcedure(10);

function deps(ctx: Context): auth.AuthDeps {
  return { db: ctx.db, email: ctx.email, ip: ctx.ip, userAgent: ctx.userAgent };
}

function setAccessCookie(ctx: Context, token: string): void {
  ctx.res?.cookie("access_token", token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: env.ACCESS_TTL_MS,
    path: "/",
  });
}

function setRefreshCookie(ctx: Context, token: string): void {
  ctx.res?.cookie("refresh_token", token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: env.REFRESH_TTL_MS,
    path: "/",
  });
}

function setSessionCookies(
  ctx: Context,
  tokens: { accessToken: string; refreshToken: string },
): void {
  setAccessCookie(ctx, tokens.accessToken);
  setRefreshCookie(ctx, tokens.refreshToken);
}

function clearSessionCookies(ctx: Context): void {
  ctx.res?.clearCookie("access_token", { path: "/" });
  ctx.res?.clearCookie("refresh_token", { path: "/" });
  ctx.res?.clearCookie("imp", { path: "/" });
}

function setImpCookie(ctx: Context, token: string): void {
  ctx.res?.cookie("imp", token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearImpCookie(ctx: Context): void {
  ctx.res?.clearCookie("imp", { path: "/" });
}

function refreshTokenFrom(ctx: Context): string {
  const token = ctx.refreshCookie;
  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: AuthError.INVALID_REFRESH_TOKEN,
    });
  }
  return token;
}

export const authRouter = router({
  register: registerProc
    .meta({ openapi: { method: "POST", path: "/auth/register", tags: ["auth"], summary: "Register a new account and send a verification OTP" } })
    .input(registerInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => auth.register(deps(ctx), input)),

  verifyEmail: verifyProc
    .meta({ openapi: { method: "POST", path: "/auth/verify-email", tags: ["auth"], summary: "Verify an email address with an OTP" } })
    .input(verifyEmailInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => auth.verifyEmail(deps(ctx), input)),

  resendVerifyOtp: resendProc
    .meta({ openapi: { method: "POST", path: "/auth/resend-verify-otp", tags: ["auth"], summary: "Re-issue an email verification OTP" } })
    .input(resendVerifyOtpInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => auth.resendVerifyOtp(deps(ctx), input)),

  login: loginProc
    .meta({ openapi: { method: "POST", path: "/auth/login", tags: ["auth"], summary: "Log in with email and password" } })
    .input(loginInput)
    .output(publicUserSchema)
    .mutation(async ({ ctx, input }) => {
      const tokens = await auth.login(deps(ctx), input);
      setSessionCookies(ctx, tokens);
      return tokens.user;
    }),

  refresh: refreshProc
    .meta({ openapi: { method: "POST", path: "/auth/refresh", tags: ["auth"], summary: "Rotate the refresh token and issue a new access token" } })
    .input(refreshInput)
    .output(publicUserSchema)
    .mutation(async ({ ctx }) => {
      const tokens = await auth.refresh(deps(ctx), refreshTokenFrom(ctx));
      setSessionCookies(ctx, tokens);
      // Carry the impersonation flag so a reload (which bootstraps via refresh)
      // keeps showing the banner. The `imp` cookie persists across rotation.
      return { ...tokens.user, impersonator: ctx.impersonator };
    }),

  logout: publicProcedure
    .meta({ openapi: { method: "POST", path: "/auth/logout", tags: ["auth"], summary: "Revoke a refresh token" } })
    .input(logoutInput)
    .output(okSchema)
    .mutation(async ({ ctx }) => {
      const result = await auth.logout(deps(ctx), refreshTokenFrom(ctx));
      clearSessionCookies(ctx);
      return result;
    }),

  forgotPassword: forgotProc
    .meta({ openapi: { method: "POST", path: "/auth/forgot-password", tags: ["auth"], summary: "Send a password-reset OTP (always succeeds)" } })
    .input(forgotPasswordInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => auth.forgotPassword(deps(ctx), input)),

  resetPassword: resetProc
    .meta({ openapi: { method: "POST", path: "/auth/reset-password", tags: ["auth"], summary: "Reset the password with an OTP and revoke all sessions" } })
    .input(resetPasswordInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => auth.resetPassword(deps(ctx), input)),

  changePassword: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/auth/change-password", tags: ["auth"], protect: true, summary: "Change the password for the authenticated user" } })
    .input(changePasswordInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => auth.changePassword(deps(ctx), ctx.user.id, input)),

  me: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/auth/me", tags: ["auth"], protect: true, summary: "Get the current authenticated user" } })
    .input(z.object({}))
    .output(publicUserSchema)
    .query(({ ctx }) => auth.getMe(deps(ctx), ctx.user.id, ctx.impersonator)),

  impersonate: superuserProcedure
    .meta({ openapi: { method: "POST", path: "/auth/impersonate", tags: ["auth"], protect: true, summary: "Start impersonating a user (superuser only)" } })
    .input(impersonateInput)
    .output(publicUserSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = { id: ctx.user.id, email: ctx.user.email };
      const tokens = await auth.impersonate(deps(ctx), actor.id, input.userId);
      setSessionCookies(ctx, tokens);
      setImpCookie(ctx, auth.signImpToken(actor));
      return { ...tokens.user, impersonator: actor };
    }),

  stopImpersonation: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/auth/stop-impersonation", tags: ["auth"], protect: true, summary: "Stop impersonating and return to the admin account" } })
    .input(z.object({}))
    .output(publicUserSchema)
    .mutation(async ({ ctx }) => {
      if (!ctx.impersonator) {
        throw new TRPCError({ code: "BAD_REQUEST", message: AuthError.INVALID_REFRESH_TOKEN });
      }
      const tokens = await auth.stopImpersonation(deps(ctx), ctx.impersonator.id);
      setSessionCookies(ctx, tokens);
      clearImpCookie(ctx);
      return { ...tokens.user, impersonator: null };
    }),
});
