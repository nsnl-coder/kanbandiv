import type { FormHTMLAttributes, ReactNode } from "react";

interface AuthFormProps extends FormHTMLAttributes<HTMLFormElement> {
  title: string;
  submitLabel: string;
  submitting?: boolean;
  error?: string | null;
  children: ReactNode;
}

export function AuthForm({
  title,
  submitLabel,
  submitting = false,
  error,
  children,
  ...formProps
}: AuthFormProps) {
  return (
    <form
      {...formProps}
      className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 className="text-xl font-semibold text-slate-800">{title}</h1>

      {error ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {children}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Please wait..." : submitLabel}
      </button>
    </form>
  );
}
