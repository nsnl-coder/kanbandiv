import { z } from "zod";
import { permissionSchema } from "./rbac.schema.js";

export const AuthRole = {
  Admin: "admin",
  User: "user",
} as const;
export type AuthRole = (typeof AuthRole)[keyof typeof AuthRole];

export const OtpPurpose = {
  VerifyEmail: "verify_email",
  ResetPassword: "reset_password",
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

export const VERIFY_OTP_LENGTH = 6;
export const RESET_OTP_LENGTH = 8;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72; // bcrypt truncation limit

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .refine((v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES, {
    message: `Password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  });

const otpSchema = (len: number) =>
  z
    .string()
    .length(len)
    .regex(/^\d+$/, "OTP must be numeric");

export const registerInput = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerInput>;

export const verifyEmailInput = z.object({
  email: emailSchema,
  otp: otpSchema(VERIFY_OTP_LENGTH),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailInput>;

export const resendVerifyOtpInput = z.object({
  email: emailSchema,
});
export type ResendVerifyOtpInput = z.infer<typeof resendVerifyOtpInput>;

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

// Refresh/logout read the rotating token from the httpOnly cookie only; never
// from the request body (a body token would defeat the httpOnly protection).
export const refreshInput = z.object({});
export type RefreshInput = z.infer<typeof refreshInput>;

export const logoutInput = refreshInput;
export type LogoutInput = z.infer<typeof logoutInput>;

export const forgotPasswordInput = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInput>;

export const resetPasswordInput = z.object({
  email: emailSchema,
  otp: otpSchema(RESET_OTP_LENGTH),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  isSuperuser: z.boolean(),
  roleId: z.string().nullable().optional(),
  emailVerified: z.boolean(),
  permissions: z.array(permissionSchema),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: publicUserSchema,
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const okSchema = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof okSchema>;
