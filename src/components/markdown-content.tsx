import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
/** Render GFM without active links, resource loads or raw HTML. */
export function MarkdownContent({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={/** Preserve copyable destinations. */ (url) => url}
      components={{
        /** Replace images with their descriptions. */ img: ({ alt }) => (
          <span>{alt ?? "Image"}</span>
        ),
        /** Present destinations without protocol activation. */ a: ({ children, href }) => (
          <span>
            {children}
            {href ? ` (${href})` : ""}
          </span>
        ),
        /** Prevent preview checkbox edits. */ input: ({ checked }) => (
          <input type="checkbox" checked={checked ?? false} disabled readOnly />
        ),
      }}
    >
      {text}
    </Markdown>
  );
}
