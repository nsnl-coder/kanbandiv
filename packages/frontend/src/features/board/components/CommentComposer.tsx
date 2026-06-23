import { useRef, useState } from "react";
import { COMMENT_BODY_MAX } from "shared";
import type { MentionMember } from "../utils";
import { MentionAutocomplete, type MentionAutocompleteHandle } from "./MentionAutocomplete";

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
  const acRef = useRef<MentionAutocompleteHandle>(null);

  if (!editable) return null;

  // Detect an in-progress @mention at the caret to drive the suggestion list.
  const onChange = (value: string) => {
    setBody(value);
    const caret = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = /(?:^|\s)@([\w.-]*)$/.exec(before);
    setQuery(m ? m[1] : null);
  };

  // Route arrow/enter/esc to the popover so the textarea caret stays put.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (query === null) return;
    if (acRef.current?.onKeyDown(e)) {
      e.preventDefault();
      if (e.key === "Escape") setQuery(null);
    }
  };

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
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
      {query !== null ? (
        <MentionAutocomplete
          ref={acRef}
          members={members}
          query={query}
          onSelect={applyMention}
        />
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
