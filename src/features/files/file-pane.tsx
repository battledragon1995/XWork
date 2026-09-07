import { Lock } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { FileHandleDto } from "@/bindings/files/files";
import { Button } from "@/components/ui/button";
import { fileErrorCopy } from "./file-error-copy";
import { useFileHandleRegistry } from "./file-handle-context";
import type { FileHandleEntryState } from "./file-handle-registry";
import { SourceView } from "./source-view";
import { UnsupportedFile } from "./unsupported-file";

/** Copy shown while the first `get_open_file` for a handle has not answered. */
export const LOADING_MESSAGE = "Opening file…";

/** Explanation attached to content that is no longer the file on disk. */
export const STALE_CONTENT_NOTE = "You are reading the last version XWork loaded.";

/** Recovery for a project whose root moved; only Explorer can reopen the file. */
export const ROOT_CHANGED_MESSAGE =
  "The project folder changed. Open this file again from the File Explorer.";

/** Defensive copy for a state a read-only handle is not expected to reach. */
export const EXTERNAL_CONFLICT_MESSAGE = "This file changed on disk.";

/** Invitation shown when the handle itself is gone and no retry can bring it back. */
export const CLOSE_PANE_INVITATION = "Close this pane and open the file again.";

/** Failures that no retry can resolve, so the pane offers closing instead. */
const NONRETRYABLE_CODES = ["windowNotAllowed", "invalidFileHandleId", "fileHandleNotFound"];

/** Failures that release the handle entry, leaving the pane with no file to read. */
const RETIRED_HANDLE_CODES = ["invalidFileHandleId", "fileHandleNotFound"];

/** Everything a pane region needs; the shared snapshot arrives from the registry. */
export interface FilePaneProps {
  region: "header" | "body";
  fileHandleId: string;
  paneTitle: string;
  isVisible: boolean;
  onRefreshSession(): void;
  onOpenProject(): void;
}

/** Render one explained state with its own recovery actions. */
function FileStateBlock(props: {
  message: string;
  detail?: string | null;
  actions: React.ReactNode;
}): React.JSX.Element {
  return (
    <div role="alert" className="grid gap-2 px-6 py-4 text-center text-on-dark">
      <p className="font-medium">{props.message}</p>
      {props.detail != null && <p className="text-sm text-muted-soft">{props.detail}</p>}
      <div className="flex flex-wrap justify-center gap-2">{props.actions}</div>
    </div>
  );
}

/** Render the retained local text of a handle whose disk state is no longer readable. */
function RetainedContent(props: {
  handle: FileHandleDto;
  file: NonNullable<Extract<FileHandleDto["state"], { kind: "missing" }>["local"]>;
  isVisible: boolean;
  readScrollTop(): number;
  writeScrollTop(value: number): void;
}): React.JSX.Element {
  return (
    <SourceView
      file={props.file}
      name={props.handle.name}
      watchMode={props.handle.watchMode}
      isVisible={props.isVisible}
      readScrollTop={props.readScrollTop}
      writeScrollTop={props.writeScrollTop}
    />
  );
}

/** Render the header region: the relative path and, for text only, the read-only badge. */
function FilePaneHeader(props: {
  handle: FileHandleDto | null;
  paneTitle: string;
}): React.JSX.Element {
  const { handle } = props;
  // Nothing authoritative is known yet, so no path is shown rather than a guessed one.
  if (handle === null) return <span className="min-w-0 flex-1" />;
  const isText = handle.state.kind === "ready" && handle.state.content.kind === "text";
  return (
    <>
      <span
        className="min-w-0 flex-1 truncate font-mono text-muted-soft"
        title={handle.relativePath}
      >
        {handle.relativePath}
      </span>
      {isText && (
        <span className="flex shrink-0 items-center gap-1 rounded-sm bg-dark px-1.5 py-0.5 text-[10px] text-muted-soft">
          <Lock aria-hidden="true" className="size-3" />
          Read-only
        </span>
      )}
    </>
  );
}

/** Render one region of a file pane from the snapshot both regions share. */
export function FilePane(props: FilePaneProps): React.JSX.Element {
  const registry = useFileHandleRegistry();
  // One entry per handle: header and body retain the same object, so one read serves both.
  const entry = useMemo(() => registry.entry(props.fileHandleId), [registry, props.fileHandleId]);
  const state: FileHandleEntryState = useSyncExternalStore(entry.subscribe, entry.getSnapshot);

  // Retaining in an effect keeps the first request out of React's render phase.
  useEffect(() => entry.retain(), [entry]);

  const handle = state.handle;
  const failureCode = state.failureCode;
  const isRetired = RETIRED_HANDLE_CODES.includes(failureCode ?? "");

  // A handle the backend no longer knows also invalidates the session snapshot that named it.
  useEffect(() => {
    if (isRetired && props.region === "body") props.onRefreshSession();
  }, [isRetired, props.region, props.onRefreshSession]);

  if (props.region === "header") {
    return <FilePaneHeader handle={handle} paneTitle={props.paneTitle} />;
  }

  /** Build the Retry control, which re-reads the same handle exactly once per press. */
  const retryButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={state.isReloading}
      onClick={() => void entry.reload()}
    >
      Retry
    </Button>
  );
  /** Build the opener control, which is disabled only while its own command is pending. */
  const openExternalButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={state.externalPending}
      onClick={() => void entry.openWithDefaultApp()}
    >
      Open with default app
    </Button>
  );
  /** Announce completed actions from the body only, so two regions never duplicate them. */
  const announcements = (
    <div role="status" aria-live="polite" className="sr-only">
      {state.announcement}
      {state.copyFeedback}
    </div>
  );
  /** Wrap one body rendering with the shared live region and any recoverable failure. */
  const body = (content: React.ReactNode, failure?: React.ReactNode) => (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {failure}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{content}</div>
      {announcements}
    </div>
  );

  if (handle === null) {
    if (state.phase === "failed") {
      const canRetry = !NONRETRYABLE_CODES.includes(failureCode ?? "");
      return body(
        <FileStateBlock
          message={state.failure ?? fileErrorCopy(null)}
          detail={isRetired ? CLOSE_PANE_INVITATION : null}
          actions={canRetry ? retryButton : null}
        />,
      );
    }
    return body(
      <p role="status" aria-busy="true" className="grid h-full place-content-center text-sm">
        {LOADING_MESSAGE}
      </p>,
    );
  }

  /** Report a failed query or reload above content that is still worth reading. */
  const recoverableFailure =
    state.phase === "failed" && state.failure !== null ? (
      <div role="alert" className="flex items-center gap-2 px-3 py-1.5 text-xs text-error">
        <span>{state.failure}</span>
        {!NONRETRYABLE_CODES.includes(failureCode ?? "") && retryButton}
        {isRetired && <span>{CLOSE_PANE_INVITATION}</span>}
      </div>
    ) : null;

  /** Render the retained snapshot of a handle whose file is missing or unreadable. */
  const retained = (file: Parameters<typeof RetainedContent>[0]["file"] | null) =>
    file === null ? null : (
      <RetainedContent
        handle={handle}
        file={file}
        isVisible={props.isVisible}
        readScrollTop={() => entry.readScrollTop()}
        writeScrollTop={(value) => entry.writeScrollTop(value)}
      />
    );

  const handleState = handle.state;
  if (handleState.kind === "ready") {
    const content = handleState.content;
    if (content.kind === "text") {
      return body(
        <SourceView
          file={content.file}
          name={handle.name}
          watchMode={handle.watchMode}
          isVisible={props.isVisible}
          readScrollTop={() => entry.readScrollTop()}
          writeScrollTop={(value) => entry.writeScrollTop(value)}
        />,
        recoverableFailure,
      );
    }
    return body(
      <UnsupportedFile
        name={handle.name}
        content={content}
        isExternalPending={state.externalPending}
        externalFailure={state.externalFailure}
        copyFeedback={state.copyFeedback}
        onOpenExternal={() => void entry.openWithDefaultApp()}
        onCopyPath={() => void entry.copyPath()}
      />,
      recoverableFailure,
    );
  }

  if (handleState.kind === "missing") {
    return body(
      <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
        <FileStateBlock
          message={`${handle.name} is no longer on disk.`}
          detail={handleState.local === null ? null : STALE_CONTENT_NOTE}
          actions={retryButton}
        />
        <div className="min-h-0 overflow-hidden">{retained(handleState.local)}</div>
      </div>,
      recoverableFailure,
    );
  }

  if (handleState.kind === "unreadable") {
    return body(
      <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
        <FileStateBlock
          message={`XWork can't read ${handle.name}.`}
          detail={handleState.local === null ? null : STALE_CONTENT_NOTE}
          actions={
            <>
              {retryButton}
              {openExternalButton}
            </>
          }
        />
        <div className="min-h-0 overflow-hidden">{retained(handleState.local)}</div>
        {state.externalFailure !== null && (
          <p role="alert" className="px-3 py-1 text-center text-xs text-error">
            {state.externalFailure}
          </p>
        )}
      </div>,
      recoverableFailure,
    );
  }

  if (handleState.kind === "projectRootChanged") {
    return body(
      <FileStateBlock
        message={ROOT_CHANGED_MESSAGE}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={props.onOpenProject}>
            Open project
          </Button>
        }
      />,
      recoverableFailure,
    );
  }

  // A read-only handle should never reach an external conflict; FE-018 owns resolution, so
  // this state offers a plain reload and nothing that could discard anyone's work.
  const reloadBlocked = failureCode === "unsavedChangesWouldBeLost";
  return body(
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <FileStateBlock
        message={
          reloadBlocked ? (state.failure ?? EXTERNAL_CONFLICT_MESSAGE) : EXTERNAL_CONFLICT_MESSAGE
        }
        actions={
          reloadBlocked ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={state.isReloading}
              onClick={() => void entry.reload()}
            >
              Reload
            </Button>
          )
        }
      />
      <div className="min-h-0 overflow-hidden">{retained(handleState.local)}</div>
    </div>,
    // A blocked reload already states its reason inside the block above.
    reloadBlocked ? null : recoverableFailure,
  );
}
