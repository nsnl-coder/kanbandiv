import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface Props {
  source: string;
}

// Links: href is already sanitized by rehype-sanitize (defaultSchema drops
// javascript:/data: protocols). We only add target + a hardened rel; we never
// re-introduce an unsanitized href.
function SafeLink({ children, href, ...rest }: ComponentPropsWithoutRef<"a">) {
  return (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

function LazyImg(props: ComponentPropsWithoutRef<"img">) {
  return <img {...props} loading="lazy" className="max-w-full rounded" alt={props.alt ?? ""} />;
}

// To block remote images entirely (tracking-pixel / exfil concern), drop `img`
// from the sanitize schema and the `components` map. Kept allowed + lazy here.
const proseClass =
  "text-sm text-foreground/80 leading-relaxed [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-indigo-600 [&_a]:underline " +
  "[&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold " +
  "[&_h3]:font-semibold [&_code]:rounded [&_code]:bg-surface-muted [&_code]:px-1 [&_code]:py-0.5 " +
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-muted [&_pre]:p-2 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted " +
  "[&_table]:my-2 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 " +
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1";

export function MarkdownView({ source }: Props) {
  if (!source.trim()) {
    return <p className="text-sm text-muted">No description</p>;
  }
  return (
    <div className={proseClass}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{ a: SafeLink, img: LazyImg }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
