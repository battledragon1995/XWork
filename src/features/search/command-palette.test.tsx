import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SearchResultDto, UnifiedSearchResponseDto } from "@/bindings/search";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { searchUnified } from "@/lib/ipc/search";
import { CommandPalette } from "./command-palette";

/** Replace only the read boundary for deterministic component assertions. */
vi.mock("@/lib/ipc/search", () => ({ searchUnified: vi.fn() }));
/** Build two ordered commands including an unavailable option. */
function response(): UnifiedSearchResponseDto {
  const results: SearchResultDto[] = ["navigation.open_home", "tabs.create"].map(
    // Keep generated DTO fields explicit in fixtures.
    (actionId) => ({
      key: actionId,
      kind: "command",
      title: actionId,
      context: null,
      titleHighlights: [],
      contextHighlights: [],
      target: { kind: "command", actionId, projectId: null },
      shortcut: null,
      supportsOpenInSplit: false,
    }),
  );
  return {
    query: "",
    groups: [{ kind: "command", label: "Commands", results, hasMore: true }],
    resultCount: 2,
    sourceFailures: [],
  };
}
/** Install a fresh read snapshot. */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(searchUnified).mockResolvedValue(response());
});
/** Remove portal and focus scope per test. */
afterEach(cleanup);
/** Mount the controlled component with application-owned availability. */
function setup(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const props: React.ComponentProps<typeof CommandPalette> = {
    open: true,
    contextProjectId: null,
    contextReady: true,
    platform: "windows",
    refreshKey: 0,
    busy: false,
    executionError: null,
    onClose: vi.fn(),
    onClosed: vi.fn(),
    onActivate: vi.fn(async () => {}),
    getTargetAvailability: (target) => ({
      enabled: target.kind !== "command" || target.actionId === "navigation.open_home",
      reason: "Not available in Command Palette yet.",
    }),
    ...overrides,
  };
  const view = render(
    <TooltipProvider>
      <CommandPalette {...props} />
    </TooltipProvider>,
  );
  return {
    ...view,
    props,
    rerenderPalette: (patch: Partial<typeof props>) =>
      view.rerender(
        <TooltipProvider>
          <CommandPalette {...props} {...patch} />
        </TooltipProvider>,
      ),
  };
}
/** Preserve groups, counts and disabled navigation while retaining input focus. */
it("renders results and wraps over disabled options", async () => {
  const { props } = setup();
  await screen.findByText("2 results");
  const input = screen.getByRole("combobox");
  expect(input).toHaveFocus();
  expect(screen.getByRole("group", { name: "Commands" })).toBeInTheDocument();
  expect(screen.getByText("More matches available. Refine your search.")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(props.onActivate).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(input, { key: "Enter", repeat: true });
  expect(props.onActivate).not.toHaveBeenCalled();
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(props.onActivate).toHaveBeenCalledTimes(1);
  expect(input).toHaveFocus();
});
/** IME owns Enter and Escape until its committed value is searchable. */
it("guards composition and clears stale options while typing", async () => {
  const { props } = setup();
  await screen.findByText("2 results");
  const input = screen.getByRole("combobox");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "Việt" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(props.onActivate).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  fireEvent.compositionEnd(input);
  await waitFor(() =>
    expect(searchUnified).toHaveBeenCalledWith({ query: "Việt", contextProjectId: null }),
  );
  fireEvent.keyDown(input, { key: "Escape" });
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
/** Modal tab navigation stays within the search surface, then delegates close focus. */
it("traps Tab and delegates close autofocus", async () => {
  const user = userEvent.setup();
  const { props, rerenderPalette } = setup();
  await screen.findByText("2 results");
  await user.tab();
  expect(screen.getByRole("button", { name: "Close search" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("combobox")).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Close search" })).toHaveFocus();
  rerenderPalette({ open: false });
  await waitFor(() => expect(props.onClosed).toHaveBeenCalledTimes(1));
});
/** Both partial states retain retry and never make a false empty assertion. */
it.each([0, 2])("renders partial results count %s", async (count) => {
  const data = response();
  data.resultCount = count;
  if (!count) data.groups = [];
  data.sourceFailures = [{ source: "projects", reason: "timeout" }];
  vi.mocked(searchUnified).mockResolvedValue(data);
  setup();
  expect(
    await screen.findByText(
      count ? "Some results are unavailable." : "Search could not load all sources.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Projects: Timed out")).toBeInTheDocument();
  expect(screen.queryByText("No results found. Try another search.")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(searchUnified).toHaveBeenCalledTimes(2);
});
/** A successful empty response offers query clearing. */
it("renders genuine empty state", async () => {
  vi.mocked(searchUnified).mockResolvedValue({
    query: "",
    groups: [],
    resultCount: 0,
    sourceFailures: [],
  });
  setup();
  expect(await screen.findByText("No results found. Try another search.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
});
/** Rejections become fixed copy; unauthorized windows cannot retry. */
it.each(["unavailable", "unauthorized_window"])("renders %s safely", async (code) => {
  vi.mocked(searchUnified).mockRejectedValue(new IpcCallError("search_unified", { code }));
  setup();
  expect(await screen.findByRole("alert")).not.toHaveTextContent("search_unified");
  expect(screen.queryByRole("button", { name: "Try again" }) !== null).toBe(
    code !== "unauthorized_window",
  );
});
/** A held callback cannot execute twice and a rejection stays visible. */
it("guards single flight and contains callback rejection", async () => {
  let reject!: (error: Error) => void;
  const onActivate = vi.fn(
    () =>
      new Promise<void>((_resolve, no) => {
        reject = no;
      }),
  );
  setup({ onActivate });
  await screen.findByText("2 results");
  const row = screen.getAllByRole("option")[0];
  if (!row) throw new Error("missing fixture");
  fireEvent.click(row);
  fireEvent.click(row);
  expect(onActivate).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("private")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not open this result. Try again.",
  );
});
