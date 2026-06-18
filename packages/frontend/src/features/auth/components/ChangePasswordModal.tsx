import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z, changePasswordInput } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";
import { PasswordField } from "./PasswordField";
import { authErrorMessage } from "../utils";

const schema = changePasswordInput
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type FormValues = z.infer<typeof schema>;

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
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
    <Modal open onClose={onClose} title="Change password">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {mutation.error ? (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {authErrorMessage(mutation.error)}
          </p>
        ) : null}
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

        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? "Please wait..." : "Update password"}
        </button>
      </form>
    </Modal>
  );
}
