import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";

interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ label, error, id, ...inputProps }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [visible, setVisible] = useState(false);
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        <div className="relative">
          <input
            {...inputProps}
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className="w-full rounded border border-slate-300 px-3 py-2 pr-16 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>
        {error ? (
          <p id={errorId} className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
