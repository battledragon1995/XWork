import type { Extension } from "@codemirror/state";
import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileWatchModeDto, TextFileDto } from "@/bindings/files/files";
import {
  EMPTY_FILE_MESSAGE,
  formatEncoding,
  formatLineCount,
  formatLineEnding,
  MARKDOWN_DEFERRAL_NOTE,
  READ_ONLY_STATUS_LABEL,
  SYNTAX_LIMIT_NOTE,
  SYNTAX_UNAVAILABLE_NOTE,
  watchModeNote,
} from "./file-facts";
import {
  isSyntaxHighlightingEligible,
  sourceLanguage,
  sourceLanguageLabel,
} from "./source-language";
import { createSourceView, type SourceViewAdapter } from "./source-view-adapter";

/** Everything the source surface needs; every displayed fact comes from the backend snapshot. */
export interface SourceViewProps {
  /** Authoritative text snapshot for the handle. */
  file: TextFileDto;
  /** File name used for the accessible label of the code region. */
  name: string;
  /** Backend watch mode, surfaced as a note when it degrades to polling. */
  watchMode: FileWatchModeDto;
  /** Whether the owning pane is on screen. A hidden pane measures nothing. */
  isVisible: boolean;
  /** Read the scroll position the registry holds for this handle. */
  readScrollTop(): number;
  /** Persist the scroll position for this handle. */
  writeScrollTop(scrollTop: number): void;
}

/** Build the accessible name of the code region for one file. */
export function sourceViewLabel(name: string): string {
  return `Source view of ${name}`;
}

/** Render the bottom fact row of the source surface. */
function SourceStatusBar(props: {
  language: string;
  encoding: string;
  lineEnding: string | null;
  lineCount: string;
  notes: string[];
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-[var(--terminal-ansi-8)] border-t px-3 py-1 text-[var(--terminal-ansi-7)] text-xs">
      <span>{props.language}</span>
      <span>{props.encoding}</span>
      {props.lineEnding !== null && <span>{props.lineEnding}</span>}
      {props.notes.map((note) => (
        <span key={note}>{note}</span>
      ))}
      <span className="ms-auto flex items-center gap-3">
        <span>{props.lineCount}</span>
        <span className="flex items-center gap-1">
          <Lock aria-hidden="true" className="size-3" />
          {READ_ONLY_STATUS_LABEL}
        </span>
      </span>
    </div>
  );
}

/** Render the read-only code surface and its status bar for one text snapshot. */
export function SourceView(props: SourceViewProps): React.JSX.Element {
  const { file, isVisible, name, watchMode } = props;
  const { byteSize, lineCount, syntaxHint, text } = file;
  const host = useRef<HTMLElement>(null);
  const adapter = useRef<SourceViewAdapter | null>(null);
  const appliedText = useRef<string | null>(null);
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null);
  const [languageFailed, setLanguageFailed] = useState(false);
  // The threshold is checked before any loader runs, so an oversized file never fetches a pack.
  const highlightable = isSyntaxHighlightingEligible({ byteSize, lineCount });
  const latest = useRef({
    text,
    isVisible,
    readScrollTop: props.readScrollTop,
    writeScrollTop: props.writeScrollTop,
  });
  // Keep long-lived listeners and teardown reading the newest props without rebuilding the view.
  useEffect(() => {
    latest.current = {
      text,
      isVisible,
      readScrollTop: props.readScrollTop,
      writeScrollTop: props.writeScrollTop,
    };
  });
  // Build the surface exactly once; content, language and Appearance all update in place.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const view = createSourceView({
      parent,
      doc: latest.current.text,
      language: null,
      // A hidden pane reports an unmeasured zero, which must not overwrite a real position.
      onScroll: (scrollTop) => {
        if (latest.current.isVisible) latest.current.writeScrollTop(scrollTop);
      },
    });
    adapter.current = view;
    appliedText.current = latest.current.text;
    view.writeScrollTop(latest.current.readScrollTop());
    // Persist the final position, then release the view and its listeners.
    return () => {
      if (latest.current.isVisible) latest.current.writeScrollTop(view.readScrollTop());
      view.destroy();
      adapter.current = null;
      appliedText.current = null;
    };
  }, []);
  // Push a reloaded snapshot through the live view and put the reader back where they were.
  useEffect(() => {
    const view = adapter.current;
    if (!view || appliedText.current === text) return;
    appliedText.current = text;
    view.setDoc(text);
    view.writeScrollTop(latest.current.readScrollTop());
  }, [text]);
  // Load the language pack for the current hint, ignoring a result that arrives too late.
  useEffect(() => {
    const entry = highlightable ? sourceLanguage(syntaxHint) : null;
    if (!entry) {
      setLanguageExtension(null);
      setLanguageFailed(false);
      return;
    }
    let active = true;
    entry.load().then(
      (extension) => {
        if (!active) return;
        setLanguageExtension(extension);
        setLanguageFailed(false);
      },
      // One rejection degrades to plain text with a note; it is never retried in a loop.
      () => {
        if (!active) return;
        setLanguageExtension(null);
        setLanguageFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [highlightable, syntaxHint]);
  // Reconfigure the language compartment rather than rebuilding the view.
  useEffect(() => {
    adapter.current?.setLanguage(languageExtension);
  }, [languageExtension]);

  const notes = [
    watchModeNote(watchMode),
    file.mode === "markdown" ? MARKDOWN_DEFERRAL_NOTE : null,
    highlightable ? null : SYNTAX_LIMIT_NOTE,
    languageFailed ? SYNTAX_UNAVAILABLE_NOTE : null,
  ].filter((note): note is string => note !== null);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--terminal-background)] text-[var(--terminal-foreground)]">
      <div className="relative min-h-0 min-w-0 flex-1">
        {/* A named section maps to an ARIA region, so the code surface has an accessible name. */}
        <section
          ref={host}
          aria-label={sourceViewLabel(name)}
          className="absolute inset-0 min-h-0 min-w-0 overflow-hidden"
        />
        {text.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--terminal-ansi-7)] text-sm">
            {EMPTY_FILE_MESSAGE}
          </p>
        )}
      </div>
      <SourceStatusBar
        language={sourceLanguageLabel(syntaxHint)}
        encoding={formatEncoding(file.encoding, file.hasUtf8Bom)}
        lineEnding={formatLineEnding(file.lineEnding)}
        lineCount={formatLineCount(lineCount)}
        notes={notes}
      />
    </div>
  );
}
