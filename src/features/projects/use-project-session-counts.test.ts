import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import type { SessionRuntimeEventDto } from "@/bindings/sessions/sessions";
import { listSessions, onSessionsRuntimeChanged } from "@/lib/ipc/sessions";
import { useProjectSessionCounts } from "./use-project-session-counts";

/** Keep every query/event inside an isolated runtime fixture. */
vi.mock("@/lib/ipc/sessions", () => ({ listSessions: vi.fn(), onSessionsRuntimeChanged: vi.fn() }));
/** Release native-listener substitutes and mounted hooks. */
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const projects: ProjectDto[] = [
  {
    id: "p",
    displayName: "P",
    rootPath: "C:/fixtures/p",
    isPinned: false,
    availability: { status: "available" },
    addedAtMs: 0,
    lastOpenedAtMs: 0,
  },
];
/** Existing and empty projects get honest counts, refreshed after runtime changes. */
it("counts all session states and refreshes after a runtime event", async () => {
  let changed!: (event: SessionRuntimeEventDto) => void;
  const unlisten = vi.fn();
  vi.mocked(onSessionsRuntimeChanged).mockImplementation(async (listener) => {
    changed = listener;
    return unlisten;
  });
  vi.mocked(listSessions).mockResolvedValue([
    {
      id: "s",
      projectId: "p",
      name: "Finished",
      status: "finished",
      runningProcessCount: 0,
      tabCount: 1,
    },
  ]);
  const view = renderHook(() => useProjectSessionCounts(projects));
  await waitFor(() => expect(view.result.current).toEqual({ p: 1 }));
  vi.mocked(listSessions).mockResolvedValue([]);
  await act(async () => {
    changed({} as SessionRuntimeEventDto);
  });
  await waitFor(() => expect(view.result.current).toEqual({}));
  view.unmount();
  expect(unlisten).toHaveBeenCalledOnce();
});
/** Read failure never manufactures a misleading zero-session state. */
it("leaves counts unknown on query failure", async () => {
  vi.mocked(listSessions).mockRejectedValue(new Error("offline"));
  vi.mocked(onSessionsRuntimeChanged).mockResolvedValue(vi.fn());
  const view = renderHook(() => useProjectSessionCounts(projects));
  await waitFor(() => expect(listSessions).toHaveBeenCalled());
  expect(view.result.current).toBeNull();
});
