import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { forgotPasswordInput, type ForgotPasswordInput } from "shared";
import { useTRPC } from "../../lib/trpc";
import { AuthForm } from "../../features/auth/components/AuthForm";
import { authErrorMessage } from "../../features/auth/utils";

export function ForgotPasswordPage() {
  const trpc = useTRPC();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordInput) });

  const mutation = useMutation(trpc.auth.forgotPassword.mutationOptions());

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <AuthForm
        title="Forgot password"
        submitLabel="Send reset code"
        submitting={mutation.isPending}
        error={mutation.error ? authErrorMessage(mutation.error) : null}
        onSubmit={onSubmit}
      >
        {mutation.isSuccess ? (
          <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            If an account exists for that email, a reset code has been sent.
            Check your inbox.
          </p>
        ) : null}

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

        <p className="text-sm text-slate-600">
          Already have a code?{" "}
          <Link
            to="/reset-password"
            className="font-medium text-slate-800 underline"
          >
            Reset password
          </Link>
        </p>

        <p className="text-sm text-slate-600">
          Remember your password?{" "}
          <Link to="/login" className="font-medium text-slate-800 underline">
            Back to sign in
          </Link>
        </p>
      </AuthForm>
    </div>
  );
}
