import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { BOARD_COLORS } from "../utils";

// Color is controlled separately (swatch picker), so it is not an RHF field.
export interface BoardFormValues {
  name: string;
  description?: string;
}

interface Props {
  register: UseFormRegister<BoardFormValues>;
  errors: FieldErrors<BoardFormValues>;
  color: string;
  onColorChange: (c: string) => void;
  disabled?: boolean;
}

const inputClass =
  "rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-surface-muted";

export function BoardFormFields({
  register,
  errors,
  color,
  onColorChange,
  disabled,
}: Props) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium text-foreground/80">
          Name
        </label>
        <input id="name" disabled={disabled} {...register("name")} className={inputClass} />
        {errors.name ? (
          <p className="text-xs text-red-600">{errors.name.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium text-foreground/80">
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          disabled={disabled}
          {...register("description")}
          className={inputClass}
        />
        {errors.description ? (
          <p className="text-xs text-red-600">{errors.description.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground/80">Color</span>
        <div className="flex flex-wrap gap-2">
          {BOARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`color ${c}`}
              aria-pressed={c === color}
              disabled={disabled}
              onClick={() => onColorChange(c)}
              style={{ backgroundColor: c }}
              className={`h-7 w-7 rounded-full ring-offset-2 disabled:opacity-50 ${
                c === color ? "ring-2 ring-slate-800" : ""
              }`}
            />
          ))}
        </div>
      </div>
    </>
  );
}
