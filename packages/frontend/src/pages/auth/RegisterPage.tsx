import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { z, registerInput } from "shared";
import { useTRPC } from "../../lib/trpc";
import { AuthForm } from "../../features/auth/components/AuthForm";
import { PasswordField } from "../../features/auth/components/PasswordField";
import { authErrorMessage } from "../../features/auth/utils";

const schema = registerInput
  .extend({ confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const mutation = useMutation(trpc.auth.register.mutationOptions());

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(
      { email: values.email, password: values.password },
      {
        onSuccess: () =>
          navigate("/verify-email", { state: { email: values.email } }),
      },
    );
  });

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <AuthForm
        title="Create your account"
        submitLabel="Register"
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

        <PasswordField
          label="Password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...register("confirm")}
        />

        <p className="text-sm text-foreground/70">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-foreground underline">
            Log in
          </Link>
        </p>
      </AuthForm>
    </div>
  );
}
