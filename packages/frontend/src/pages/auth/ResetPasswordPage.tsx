import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z, resetPasswordInput, RESET_OTP_LENGTH } from "shared";
import { useTRPC } from "../../lib/trpc";
import { AuthForm } from "../../features/auth/components/AuthForm";
import { PasswordField } from "../../features/auth/components/PasswordField";
import { OtpField } from "../../features/auth/components/OtpField";
import { authErrorMessage } from "../../features/auth/utils";

const schema = resetPasswordInput
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: params.get("email") ?? "", otp: "" },
  });

  const mutation = useMutation(trpc.auth.resetPassword.mutationOptions());

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(
      { email: values.email, otp: values.otp, newPassword: values.newPassword },
      { onSuccess: () => navigate("/login", { replace: true }) },
    );
  });

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <AuthForm
        title="Reset password"
        submitLabel="Reset password"
        submitting={mutation.isPending}
        error={mutation.error ? authErrorMessage(mutation.error) : null}
        onSubmit={onSubmit}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-foreground/80">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          {errors.email ? (
            <p className="text-xs text-red-600">{errors.email.message}</p>
          ) : null}
        </div>

        <OtpField
          label="Reset code"
          length={RESET_OTP_LENGTH as 8}
          error={errors.otp?.message}
          {...register("otp")}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register("newPassword")}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...register("confirm")}
        />

        <p className="text-sm text-foreground/70">
          Remember your password?{" "}
          <Link to="/login" className="font-medium text-foreground underline">
            Back to sign in
          </Link>
        </p>
      </AuthForm>
    </div>
  );
}
