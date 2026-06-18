import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AuthError, loginInput, type LoginInput } from "shared";
import { useTRPC } from "../../lib/trpc";
import { useAuthStore } from "../../hooks/useAuthStore";
import { AuthForm } from "../../features/auth/components/AuthForm";
import { PasswordField } from "../../features/auth/components/PasswordField";
import { authErrorKey, authErrorMessage } from "../../features/auth/utils";
import { homeFor } from "../../features/rbac/utils";

export function LoginPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginInput) });

  const mutation = useMutation(trpc.auth.login.mutationOptions());

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: (user) => {
        setAuth(user);
        const next = params.get("next");
        navigate(next ?? homeFor(user), { replace: true });
      },
    });
  });

  const errKey = mutation.error ? authErrorKey(mutation.error) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <AuthForm
        title="Log in"
        submitLabel="Log in"
        submitting={mutation.isPending}
        error={mutation.error ? authErrorMessage(mutation.error) : null}
        onSubmit={onSubmit}
      >
        {errKey === AuthError.EMAIL_NOT_VERIFIED ? (
          <Link
            to="/verify-email"
            state={{ email: getValues("email") }}
            className="-mt-2 text-sm font-medium text-slate-800 underline"
          >
            Resend verification code
          </Link>
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

        <PasswordField
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />

        <div className="flex justify-between text-sm text-slate-600">
          <Link to="/register" className="font-medium text-slate-800 underline">
            Create account
          </Link>
          <Link
            to="/forgot-password"
            className="font-medium text-slate-800 underline"
          >
            Forgot password?
          </Link>
        </div>
      </AuthForm>
    </div>
  );
}
