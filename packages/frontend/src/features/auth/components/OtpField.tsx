import { forwardRef, useId, type InputHTMLAttributes } from "react";

interface OtpFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "maxLength"> {
  label: string;
  length: 6 | 8;
  error?: string;
}

export const OtpField = forwardRef<HTMLInputElement, OtpFieldProps>(
  function OtpField({ label, length, error, id, ...inputProps }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground/80">
          {label}
        </label>
        <input
          {...inputProps}
          ref={ref}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={length}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="w-full rounded-lg border border-border px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-indigo-500"
        />
        {error ? (
          <p id={errorId} className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
