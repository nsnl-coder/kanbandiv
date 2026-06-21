import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { ProjectVisibility } from "shared";
import { PROJECT_COLORS, VISIBILITY_LABELS } from "../utils";

// Color is controlled separately (swatch picker), so it is not an RHF field.
export interface ProjectFormValues {
  name: string;
  description?: string;
  visibility: ProjectVisibility;
}

interface Props {
  register: UseFormRegister<ProjectFormValues>;
  errors: FieldErrors<ProjectFormValues>;
  color: string;
  onColorChange: (c: string) => void;
  disabled?: boolean;
  // Visibility is owner-only on edit; disable it independently of the rest.
  visibilityDisabled?: boolean;
}

const inputClass =
  "rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-surface-muted";

export function ProjectFormFields({
  register,
  errors,
  color,
  onColorChange,
  disabled,
  visibilityDisabled,
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
          {PROJECT_COLORS.map((c) => (
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

      <div className="flex flex-col gap-1">
        <label htmlFor="visibility" className="text-sm font-medium text-foreground/80">
          Visibility
        </label>
        <select
          id="visibility"
          disabled={disabled || visibilityDisabled}
          {...register("visibility")}
          className={inputClass}
        >
          <option value={ProjectVisibility.Private}>
            {VISIBILITY_LABELS[ProjectVisibility.Private]}
          </option>
          <option value={ProjectVisibility.Public}>
            {VISIBILITY_LABELS[ProjectVisibility.Public]}
          </option>
        </select>
        {visibilityDisabled && !disabled ? (
          <p className="text-xs text-muted">Only the owner can change visibility.</p>
        ) : null}
      </div>
    </>
  );
}
