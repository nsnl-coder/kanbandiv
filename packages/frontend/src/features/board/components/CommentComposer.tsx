import { useRef, useState } from "react";
import { COMMENT_BODY_MAX } from "shared";
import type { MentionMember } from "../utils";

interface Props {
  members: MentionMember[];
  editable: boolean;
  placeholder?: string;
  submitLabel?: string;
  initialBody?: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}

export function CommentComposer({
  members,
  editable,
  placeholder = "Write a comment...",
  submitLabel = "Comment",
  initialBody = "",
  onSubmit,
  onCancel,
}: Props) {
  const [body, setBody] = useState(initialBody);
  const [query, setQuery] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  if (!editable) return null;

  // Detect an in-progress @mention at the caret to drive the suggestion list.
  const onChange = (value: string) => {
    setBody(value);
    const caret = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = /(?:^|\s)@([\w.-]*)$/.exec(before);
    setQuery(m ? m[1] : null);
  };

  const suggestions =
    query === null
      ? []
      : members.filter((m) => m.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);

  const applyMention = (name: string) => {
    const caret = ref.current?.selectionStart ?? body.length;
    const before = body.slice(0, caret);
    const after = body.slice(caret);
    const replaced = before.replace(/@([\w.-]*)$/, `@${name} `);
    setBody(replaced + after);
    setQuery(null);
    ref.current?.focus();
  };

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setBody("");
    setQuery(null);
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        aria-label="comment body"
        rows={3}
        value={body}
        placeholder={placeholder}
        maxLength={COMMENT_BODY_MAX}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
      {suggestions.length > 0 ? (
        <ul
          aria-label="mention suggestions"
          className="absolute z-10 mt-1 w-48 rounded-lg border border-border bg-surface shadow-lg"
        >
          {suggestions.map((m) => (
            <li key={m.name}>
              <button
                type="button"
                aria-label={`mention ${m.name}`}
                onClick={() => applyMention(m.name)}
                className="block w-full px-3 py-1.5 text-left text-sm text-foreground/80 hover:bg-surface-muted"
              >
                @{m.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!body.trim()}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
