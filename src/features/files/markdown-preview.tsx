import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
/** Render untrusted GFM without resource loads, HTML or navigable links. */
export function MarkdownPreview(props: {
  text: string;
  onEdit(): void;
  initialScrollTop?: number;
  onScroll?(value: number): void;
}) {
  const scroller = useRef<HTMLElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = props.initialScrollTop ?? 0;
  }, [props.initialScrollTop]);
  if (!props.text)
    return (
      <div className="p-5">
        <p>This file is empty. Switch to Edit to add Markdown.</p>
        <button type="button" onClick={props.onEdit}>
          Edit
        </button>
      </div>
    );
  return (
    <article
      ref={scroller}
      onScroll={(event) => props.onScroll?.(event.currentTarget.scrollTop)}
      className="h-full overflow-auto p-5 text-body-strong [&_h1]:text-2xl [&_h2]:text-xl [&_pre]:overflow-auto [&_pre]:bg-surface-card [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => url}
        components={{
          /** Display image descriptions without producing resource-bearing elements. */
          img: ({ alt }) => <span>{alt ?? "Image"}</span>,
          /** Keep destinations copyable without navigation or protocol activation. */
          a: ({ children, href }) => (
            <span>
              {children}
              {href ? ` (${href})` : ""}
            </span>
          ),
          /** Task lists are read-only preview controls. */
          input: ({ checked }) => (
            <input type="checkbox" checked={checked ?? false} disabled readOnly />
          ),
        }}
      >
        {props.text}
      </Markdown>
    </article>
  );
}
