import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEWER_LIMIT_BYTES } from "./files-test-fixture";
import { UnsupportedFile, type UnsupportedContentDto } from "./unsupported-file";

afterEach(cleanup);

/** Render the block with inert actions and only the properties a case needs. */
function show(
  content: UnsupportedContentDto,
  overrides: Partial<Parameters<typeof UnsupportedFile>[0]> = {},
) {
  const props = {
    name: "logo.png",
    content,
    isExternalPending: false,
    externalFailure: null,
    copyFeedback: "",
    onOpenExternal: vi.fn(),
    onCopyPath: vi.fn(),
    ...overrides,
  };
  render(<UnsupportedFile {...props} />);
  return props;
}

describe("UnsupportedFile", () => {
  // Verify the binary block states the real MIME type and size and offers both ways out.
  it("explains a binary file with its backend facts", () => {
    const props = show({ kind: "binary", byteSize: 4_096n, mimeType: "image/png" });

    expect(screen.getByText("Can't show logo.png")).toBeInTheDocument();
    expect(
      screen.getByText("This is a binary file. XWork only shows text and source files."),
    ).toBeInTheDocument();
    expect(screen.getByText("4 KB · image/png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open with default app" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    expect(props.onOpenExternal).toHaveBeenCalledOnce();
    expect(props.onCopyPath).toHaveBeenCalledOnce();
  });

  // Verify the oversize block reports the backend limit rather than a hard-coded number.
  it("explains an oversized file with its real limit", () => {
    show(
      {
        kind: "tooLarge",
        byteSize: 6_291_456n,
        limitBytes: VIEWER_LIMIT_BYTES,
        mimeType: "text/plain",
      },
      { name: "dump.log" },
    );

    expect(screen.getByText("Can't show dump.log")).toBeInTheDocument();
    expect(screen.getByText("This file is larger than the 5 MB viewer limit.")).toBeInTheDocument();
    expect(screen.getByText("6 MB · limit 5 MB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open with default app" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy path" })).toBeEnabled();
  });

  // Verify the opener locks while pending and keeps its own retry after a refusal.
  it("locks the opener while pending and retries only the opening", () => {
    const props = show(
      { kind: "binary", byteSize: 1n, mimeType: "application/octet-stream" },
      {
        isExternalPending: true,
        externalFailure: "Could not open this file with the default app.",
      },
    );

    expect(screen.getByRole("button", { name: "Open with default app" })).toBeDisabled();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBeDisabled();
    expect(screen.getByText("Could not open this file with the default app.")).toBeInTheDocument();
    // Copying stays available: it does not depend on the opener command at all.
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    expect(props.onCopyPath).toHaveBeenCalledOnce();
  });

  // Verify copy feedback only appears once the caller reports a completed write.
  it("shows copy feedback only when the caller supplies it", () => {
    show({ kind: "binary", byteSize: 1n, mimeType: "image/png" });
    expect(screen.queryByText("Path copied.")).not.toBeInTheDocument();

    cleanup();
    show({ kind: "binary", byteSize: 1n, mimeType: "image/png" }, { copyFeedback: "Path copied." });
    expect(screen.getByText("Path copied.")).toBeInTheDocument();
  });
});
