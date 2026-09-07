import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileHandleDto } from "@/bindings/files/files";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import {
  deferred,
  externalConflictState,
  handle,
  missingState,
  projectRootChangedState,
  readyBinaryState,
  readyTextState,
  readyTooLargeState,
  textFile,
  unreadableState,
  VIEWER_LIMIT_BYTES,
} from "./files-test-fixture";
import { FileHandleProvider } from "./file-handle-provider";
import { FileHandleRegistry, type FileHandleRegistryDependencies } from "./file-handle-registry";
import { FilePane } from "./file-pane";

// No CodeMirror view is mounted in jsdom; the surface is an inert adapter double.
vi.mock("./source-view-adapter", () => ({
  createSourceView: vi.fn(() => ({
    setDoc: vi.fn(),
    setLanguage: vi.fn(),
    readScrollTop: () => 0,
    writeScrollTop: vi.fn(),
    destroy: vi.fn(),
  })),
}));

/** Every isolated transport seam the registry receives for one case. */
const transport = {
  getOpenFile: vi.fn<FileHandleRegistryDependencies["getOpenFile"]>(),
  reloadOpenFile: vi.fn<FileHandleRegistryDependencies["reloadOpenFile"]>(),
  openFileWithDefaultApp: vi.fn<FileHandleRegistryDependencies["openFileWithDefaultApp"]>(),
  onFileHandleChanged: vi.fn<FileHandleRegistryDependencies["onFileHandleChanged"]>(),
  getFileEntryPaths: vi.fn<FileHandleRegistryDependencies["getFileEntryPaths"]>(),
  writeText: vi.fn<FileHandleRegistryDependencies["writeText"]>(),
};

beforeEach(() => {
  vi.clearAllMocks();
  transport.onFileHandleChanged.mockResolvedValue(() => {});
  transport.openFileWithDefaultApp.mockResolvedValue(undefined);
  transport.getFileEntryPaths.mockResolvedValue({
    relativePath: "src/main.rs",
    absolutePath: "X:/isolated-fixture/src/main.rs",
  });
  transport.writeText.mockResolvedValue(undefined);
});
afterEach(cleanup);

/** Render one or both regions of a pane over an isolated registry. */
function mount(options: {
  regions?: ("header" | "body")[];
  onRefreshSession?: () => void;
  onOpenProject?: () => void;
}) {
  const regions = options.regions ?? ["body"];
  return render(
    <FileHandleProvider createRegistry={() => new FileHandleRegistry(transport)}>
      {regions.map((region) => (
        <FilePane
          key={region}
          region={region}
          fileHandleId={handle().id}
          paneTitle="main.rs"
          isVisible
          onRefreshSession={options.onRefreshSession ?? (() => {})}
          onOpenProject={options.onOpenProject ?? (() => {})}
        />
      ))}
    </FileHandleProvider>,
  );
}

/** Answer the first query with one snapshot and wait until it is on screen. */
async function withHandle(snapshot: FileHandleDto, options: Parameters<typeof mount>[0] = {}) {
  transport.getOpenFile.mockResolvedValue(snapshot);
  const view = mount(options);
  await waitFor(() => expect(transport.getOpenFile).toHaveBeenCalled());
  return view;
}

describe("FilePane loading and text", () => {
  // Verify the first read is announced as busy and the header stays silent until it answers.
  it("reports loading without inventing a path", async () => {
    const pending = deferred<FileHandleDto>();
    transport.getOpenFile.mockReturnValue(pending.promise);
    mount({ regions: ["header", "body"] });

    const status = await screen.findByText("Opening file…");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("src/main.rs")).not.toBeInTheDocument();

    await act(async () => pending.resolve(handle()));
    expect(await screen.findByText("src/main.rs")).toBeInTheDocument();
  });

  // Verify both regions share one snapshot and therefore one backend read.
  it("issues one read for two regions and badges only text", async () => {
    await withHandle(handle(), { regions: ["header", "body"] });

    await screen.findByText("src/main.rs");
    expect(transport.getOpenFile).toHaveBeenCalledExactlyOnceWith({ fileHandleId: handle().id });
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.getByText("src/main.rs")).toHaveAttribute("title", "src/main.rs");
  });

  // Verify a Markdown snapshot stays source-only, with no Edit or Preview control.
  it("keeps Markdown read-only with its deferral note", async () => {
    await withHandle(handle({ state: readyTextState({ syntaxHint: "md", mode: "markdown" }) }), {
      regions: ["header", "body"],
    });

    expect(
      await screen.findByText("Editing and preview arrive with the Markdown editor."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit|Preview/ })).not.toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
  });
});

describe("FilePane unsupported content", () => {
  // Verify binary and oversize content report real facts and carry no read-only badge.
  it.each([
    {
      label: "binary",
      state: readyBinaryState(4_096n, "image/png"),
      facts: "4 KB · image/png",
    },
    {
      label: "tooLarge",
      state: readyTooLargeState(6_291_456n, VIEWER_LIMIT_BYTES),
      facts: "6 MB · limit 5 MB",
    },
  ])("renders $label content with both actions", async ({ state, facts }) => {
    await withHandle(handle({ state }), { regions: ["header", "body"] });

    expect(await screen.findByText("Can't show main.rs")).toBeInTheDocument();
    expect(screen.getByText(facts)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open with default app" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
    // Only text presentation earns the badge.
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });

  // Verify one press runs one opener command and the button locks while it is pending.
  it("locks the opener for one command per press", async () => {
    const pending = deferred<void>();
    transport.openFileWithDefaultApp.mockReturnValue(pending.promise);
    await withHandle(handle({ state: readyBinaryState() }));
    const button = await screen.findByRole("button", { name: "Open with default app" });

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(transport.openFileWithDefaultApp).toHaveBeenCalledOnce();

    await act(async () => pending.resolve());
    await waitFor(() => expect(button).toBeEnabled());
  });

  // Verify copying resolves a fresh path first and announces only after the write completes.
  it("announces a copied path only after the clipboard write", async () => {
    const write = deferred<void>();
    transport.writeText.mockReturnValue(write.promise);
    await withHandle(handle({ state: readyBinaryState() }));

    fireEvent.click(await screen.findByRole("button", { name: "Copy path" }));
    await waitFor(() =>
      expect(transport.getFileEntryPaths).toHaveBeenCalledExactlyOnceWith({
        projectId: handle().projectId,
        relativePath: "src/main.rs",
      }),
    );
    await waitFor(() =>
      expect(transport.writeText).toHaveBeenCalledWith("X:/isolated-fixture/src/main.rs"),
    );
    expect(screen.queryByText("Path copied.")).not.toBeInTheDocument();

    await act(async () => write.resolve());
    expect(await screen.findByText("Path copied.")).toBeInTheDocument();
  });
});

describe("FilePane recovery states", () => {
  // Verify each non-ready state explains itself and exposes only its valid recovery.
  it.each([
    {
      label: "missing with retained content",
      state: missingState(textFile()),
      message: "main.rs is no longer on disk.",
      buttons: ["Retry"],
      detail: "You are reading the last version XWork loaded.",
    },
    {
      label: "missing without content",
      state: missingState(null),
      message: "main.rs is no longer on disk.",
      buttons: ["Retry"],
      detail: null,
    },
    {
      label: "unreadable",
      state: unreadableState(textFile()),
      message: "XWork can't read main.rs.",
      buttons: ["Retry", "Open with default app"],
      detail: "You are reading the last version XWork loaded.",
    },
    {
      label: "project root changed",
      state: projectRootChangedState(),
      message: "The project folder changed. Open this file again from the File Explorer.",
      buttons: ["Open project"],
      detail: null,
    },
    {
      label: "external conflict",
      state: externalConflictState(),
      message: "This file changed on disk.",
      buttons: ["Reload"],
      detail: null,
    },
  ])("renders the $label state", async ({ state, message, buttons, detail }) => {
    await withHandle(handle({ state }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    for (const name of buttons) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    if (detail !== null) expect(screen.getByText(detail)).toBeInTheDocument();
    else expect(screen.queryByText(/last version XWork loaded/)).not.toBeInTheDocument();
  });

  // Verify Retry re-reads the same handle exactly once per press.
  it("reloads the same handle from Retry", async () => {
    transport.reloadOpenFile.mockResolvedValue(handle());
    await withHandle(handle({ state: missingState(null) }));

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(transport.reloadOpenFile).toHaveBeenCalledExactlyOnceWith({
        fileHandleId: handle().id,
      }),
    );
  });

  // Verify Open project hands recovery to the app rather than calling a Files command.
  it("routes root recovery through the app callback", async () => {
    const onOpenProject = vi.fn();
    await withHandle(handle({ state: projectRootChangedState() }), { onOpenProject });

    fireEvent.click(await screen.findByRole("button", { name: "Open project" }));

    expect(onOpenProject).toHaveBeenCalledOnce();
    expect(transport.reloadOpenFile).not.toHaveBeenCalled();
  });

  // Verify a refused reload keeps the previous content on screen with a retry.
  it("keeps content after a recoverable reload failure", async () => {
    transport.reloadOpenFile.mockRejectedValue(
      new IpcCallError("reload_open_file", { code: "fileReadFailed" }),
    );
    await withHandle(handle({ state: externalConflictState() }));

    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));

    expect(await screen.findByText("Could not read this file.")).toBeInTheDocument();
    expect(screen.getByText("This file changed on disk.")).toBeInTheDocument();
  });

  // Verify a conflict whose reload would discard work loses its Reload action entirely.
  it("removes Reload after unsavedChangesWouldBeLost", async () => {
    transport.reloadOpenFile.mockRejectedValue(
      new IpcCallError("reload_open_file", { code: "unsavedChangesWouldBeLost" }),
    );
    await withHandle(handle({ state: externalConflictState() }));

    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));

    expect(
      await screen.findByText("Resolve unsaved changes before reloading."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument(),
    );
  });
});

describe("FilePane query failures", () => {
  // Verify a retryable query failure explains itself and offers exactly one retry.
  it("offers Retry after a retryable query failure", async () => {
    transport.getOpenFile.mockRejectedValue(
      new IpcCallError("get_open_file", { code: "fileReadFailed" }),
    );
    mount({});

    expect(await screen.findByText("Could not read this file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  // Verify the three non-retryable codes never offer a retry.
  it.each([
    { code: "windowNotAllowed", message: "File Explorer is only available in the main window." },
    { code: "invalidFileHandleId", message: "Could not identify this open file." },
    { code: "fileHandleNotFound", message: "This file is no longer open." },
  ])("refuses retry after $code", async ({ code, message }) => {
    const onRefreshSession = vi.fn();
    transport.getOpenFile.mockRejectedValue(
      new IpcCallError("get_open_file", { code, file_handle_id: handle().id }),
    );
    mount({ onRefreshSession });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    if (code === "windowNotAllowed") {
      expect(onRefreshSession).not.toHaveBeenCalled();
    } else {
      // A handle the backend forgot also invalidates the session snapshot that named it.
      expect(screen.getByText("Close this pane and open the file again.")).toBeInTheDocument();
      await waitFor(() => expect(onRefreshSession).toHaveBeenCalled());
    }
  });
});
