import { useState } from "react";
import { CARD_DESCRIPTION_MAX } from "shared";
import { MarkdownView } from "./MarkdownView";

interface Props {
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
}

export function DescriptionEditor({ value, onChange, editable }: Props) {
  const [mode, setMode] = useState<"write" | "preview">("write");

  if (!editable) {
    return <MarkdownView source={value} />;
  }

  const tabClass = (active: boolean) =>
    `rounded px-2 py-1 text-xs font-medium ${
      active ? "bg-surface-muted text-foreground" : "text-muted hover:bg-surface-muted"
    }`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={mode === "write"}
          onClick={() => setMode("write")}
          className={tabClass(mode === "write")}
        >
          Write
        </button>
        <button
          type="button"
          aria-pressed={mode === "preview"}
          onClick={() => setMode("preview")}
          className={tabClass(mode === "preview")}
        >
          Preview
        </button>
        <span className="ml-auto text-xs text-muted">Markdown supported</span>
      </div>
      {mode === "write" ? (
        <textarea
          id="card-description"
          aria-label="description"
          rows={4}
          value={value}
          maxLength={CARD_DESCRIPTION_MAX}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
      ) : (
        <div className="min-h-[6rem] rounded-lg border border-border px-3 py-2">
          <MarkdownView source={value} />
        </div>
      )}
    </div>
  );
}
