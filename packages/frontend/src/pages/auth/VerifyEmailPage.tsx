import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { verifyEmailInput, type VerifyEmailInput, VERIFY_OTP_LENGTH } from "shared";
import { useTRPC } from "../../lib/trpc";
import { AuthForm } from "../../features/auth/components/AuthForm";
import { OtpField } from "../../features/auth/components/OtpField";
import { authErrorMessage } from "../../features/auth/utils";

interface LocationState {
  email?: string;
}

export function VerifyEmailPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const stateEmail = (location.state as LocationState | null)?.email;
  const defaultEmail = stateEmail ?? params.get("email") ?? "";

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<VerifyEmailInput>({
    resolver: zodResolver(verifyEmailInput),
    defaultValues: { email: defaultEmail, otp: "" },
  });

  const verify = useMutation(trpc.auth.verifyEmail.mutationOptions());
  const resend = useMutation(trpc.auth.resendVerifyOtp.mutationOptions());

  const onSubmit = handleSubmit((values) => {
    verify.mutate(values, {
      onSuccess: () => navigate("/login", { replace: true }),
    });
  });

  const topError = verify.error
    ? authErrorMessage(verify.error)
    : resend.error
      ? authErrorMessage(resend.error)
      : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <AuthForm
        title="Verify your email"
        submitLabel="Verify"
        submitting={verify.isPending}
        error={topError}
        onSubmit={onSubmit}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          {errors.email ? (
            <p className="text-xs text-red-600">{errors.email.message}</p>
          ) : null}
        </div>

        <OtpField
          label="Verification code"
          length={VERIFY_OTP_LENGTH as 6}
          error={errors.otp?.message}
          {...register("otp")}
        />

        {resend.isSuccess ? (
          <p className="text-xs text-green-700">A new code has been sent.</p>
        ) : null}

        <button
          type="button"
          disabled={resend.isPending}
          onClick={() => resend.mutate({ email: getValues("email") })}
          className="text-sm font-medium text-slate-800 underline disabled:opacity-50"
        >
          Resend code
        </button>
      </AuthForm>
    </div>
  );
}
