import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z, changePasswordInput } from "shared";
import { useTRPC } from "../../lib/trpc";
import { AuthForm } from "../../features/auth/components/AuthForm";
import { PasswordField } from "../../features/auth/components/PasswordField";
import { authErrorMessage } from "../../features/auth/utils";

const schema = changePasswordInput
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type FormValues = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const trpc = useTRPC();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const mutation = useMutation(trpc.auth.changePassword.mutationOptions());

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      { onSuccess: () => reset() },
    );
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <AuthForm
        title="Change password"
        submitLabel="Update password"
        submitting={mutation.isPending}
        error={mutation.error ? authErrorMessage(mutation.error) : null}
        onSubmit={onSubmit}
      >
        {mutation.isSuccess ? (
          <p
            role="status"
            className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            Password updated successfully.
          </p>
        ) : null}

        <PasswordField
          label="Current password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register("currentPassword")}
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
      </AuthForm>
    </div>
  );
}
