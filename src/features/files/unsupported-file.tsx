import { FileX2 } from "lucide-react";
import type { FileContentDto } from "@/bindings/files/files";
import { Button } from "@/components/ui/button";
import { formatByteSize } from "./file-facts";

/** The two contents the viewer deliberately does not render. */
export type UnsupportedContentDto = Extract<FileContentDto, { kind: "binary" | "tooLarge" }>;

/** Explain a binary file, which never becomes viewable by retrying. */
export const BINARY_EXPLANATION = "This is a binary file. XWork only shows text and source files.";

/** Confirm one completed clipboard write, never an optimistic one. */
export const PATH_COPIED_MESSAGE = "Path copied.";

/** Build the size line, which always states the backend's own numbers. */
export function unsupportedFacts(content: UnsupportedContentDto): string {
  return content.kind === "binary"
    ? `${formatByteSize(content.byteSize)} · ${content.mimeType}`
    : `${formatByteSize(content.byteSize)} · limit ${formatByteSize(content.limitBytes)}`;
}

/** Explain a file the viewer will not render, with the two ways out of that state. */
export function UnsupportedFile(props: {
  name: string;
  content: UnsupportedContentDto;
  /** True while `open_file_with_default_app` has not answered yet. */
  isExternalPending: boolean;
  /** Last opener failure, kept on screen with its own retry. */
  externalFailure: string | null;
  /** Result of the last copy attempt, published only after the write resolved. */
  copyFeedback: string;
  onOpenExternal(): void;
  onCopyPath(): void;
}): React.JSX.Element {
  const { content, name } = props;
  return (
    <div className="grid h-full place-content-center gap-2 px-6 text-center text-on-dark">
      <FileX2 aria-hidden="true" className="mx-auto size-8 text-muted-soft" />
      <p className="font-medium">{`Can't show ${name}`}</p>
      <p className="text-sm text-muted-soft">
        {content.kind === "binary"
          ? BINARY_EXPLANATION
          : `This file is larger than the ${formatByteSize(content.limitBytes)} viewer limit.`}
      </p>
      <p className="font-mono text-xs text-muted-soft">{unsupportedFacts(content)}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.isExternalPending}
          onClick={props.onOpenExternal}
        >
          Open with default app
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={props.onCopyPath}>
          Copy path
        </Button>
      </div>
      {props.externalFailure !== null && (
        <div role="alert" className="text-xs text-error">
          <p>{props.externalFailure}</p>
          {/* The retry repeats the opening, never an unrelated reload of the snapshot. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.isExternalPending}
            onClick={props.onOpenExternal}
          >
            Try again
          </Button>
        </div>
      )}
      {props.copyFeedback !== "" && <p className="text-xs text-muted-soft">{props.copyFeedback}</p>}
    </div>
  );
}
