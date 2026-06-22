import { useState } from "react";
import { Bug } from "lucide-react";
import { ReportBugModal } from "./ReportBugModal";

interface Props {
  className?: string;
  label?: string;
}

// Opens the report-bug modal from anywhere. Used in the user shell + admin layout.
export function ReportBugButton({ className, label = "Report a bug" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={
          className ??
          "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-muted hover:text-foreground/80"
        }
      >
        <Bug className="h-4 w-4" />
      </button>
      <ReportBugModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
