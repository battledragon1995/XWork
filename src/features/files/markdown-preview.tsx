import { useEffect, useRef } from "react";
import { MarkdownContent } from "@/components/markdown-content";

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
      <div className="h-full bg-canvas p-5 text-body">
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
      className="h-full overflow-auto bg-canvas p-5 leading-relaxed text-body-strong [&_h1]:mb-4 [&_h1]:font-display [&_h1]:text-3xl [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-2xl [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-surface-card [&_pre]:p-3 [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
    >
      <MarkdownContent text={props.text} />
    </article>
  );
}
