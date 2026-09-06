import { useEffect, useRef, useState } from "react";
import type { FileTreeEntryDto, FileTreePageDto, FileTreeSearchDto } from "@/bindings/files/files";
import type { ProjectDto } from "@/bindings/projects/projects";
import {
  getFileEntryPaths,
  listFileChildren,
  revealFileEntry,
  searchFileTree,
} from "@/lib/ipc/files";
import { getProject, onProjectsChanged, type UnlistenFn } from "@/lib/ipc/projects";
import { fileErrorCode, fileErrorCopy, INVALID_FILTER, validFilter } from "./file-error-copy";
import type { FileExplorerProps } from "./file-explorer";

/** Retain one directory and only its latest page diagnostics. */
export interface FileBranchState {
  entries: FileTreeEntryDto[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
  stale: boolean;
  lastPage: FileTreePageDto | null;
  error: string | null;
}
/** Keep route-local presentation data separate from native path authority. */
interface ExplorerState {
  project: ProjectDto | null;
  generation: number;
  query: string;
  expanded: Set<string>;
  branches: Map<string, FileBranchState>;
  search: FileTreeSearchDto | null;
  searchStatus: "idle" | "loading" | "ready" | "error";
  selectedPath: string | null;
  pendingAction: boolean;
  feedback: string;
  actionError: string;
  error: string;
  errorCode: string | undefined;
  validation: string;
  limited: boolean;
  blocked: boolean;
}
/** Allocate a fresh snapshot without sharing caches between routes. */
function initialState(): ExplorerState {
  return {
    project: null,
    generation: 0,
    query: "",
    expanded: new Set(),
    branches: new Map(),
    search: null,
    searchStatus: "idle",
    selectedPath: null,
    pendingAction: false,
    feedback: "",
    actionError: "",
    error: "",
    errorCode: undefined,
    validation: "",
    limited: false,
    blocked: false,
  };
}
/** Identify a scheduled scan while preserving occupied capacity until actual settlement. */
interface Scan {
  key: string;
  generation: number;
  valid(): boolean;
  run(): Promise<void>;
}

/** Coordinate the single Explorer lifetime; never export or share this scheduler. */
class ExplorerController {
  state = initialState();
  active = false;
  props: FileExplorerProps;
  publish: (state: ExplorerState) => void;
  generation = 0;
  epoch = 0;
  identity = "";
  root: string | null = null;
  queue: Scan[] = [];
  running = new Set<string>();
  timer: ReturnType<typeof setTimeout> | undefined;
  composing = false;
  queryToken = 0;
  branchTokens = new Map<string, number>();
  treeStale = false;
  refreshPending = false;
  refreshAgain = false;
  bootstrapping = false;
  rootRecovery = false;
  detach: UnlistenFn | undefined;
  subscription = 0;
  subscribed = false;
  actionRunning = false;

  /** Bind the React publisher and the synchronous owner reader. */
  constructor(props: FileExplorerProps, publish: (state: ExplorerState) => void) {
    this.props = props;
    this.publish = publish;
  }
  /** Publish a new envelope after modifying this controller's private collections. */
  emit() {
    this.state = { ...this.state, generation: this.generation, pendingAction: this.actionRunning };
    this.publish(this.state);
  }
  /** Guard every dispatch, completion, and follow-on native side effect. */
  current(generation = this.generation): boolean {
    const live = this.props.readBoundary();
    return (
      this.active &&
      this.props.isVisible &&
      !live.suspended &&
      live.epoch === this.epoch &&
      generation === this.generation &&
      this.identity === `${this.props.sessionId}:${this.props.projectId}`
    );
  }
  /** Retire work without pretending to cancel an already dispatched IPC call. */
  retire(clearIntent = false) {
    this.generation++;
    this.queryToken++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
    this.branchTokens.clear();
    this.refreshPending = false;
    this.refreshAgain = false;
    this.bootstrapping = false;
    const { query, expanded } = this.state;
    this.state = initialState();
    if (!clearIntent) {
      this.state.query = query;
      this.state.expanded = new Set(expanded);
    }
    this.emit();
  }
  /** Attach invalidation before reading metadata, disposing late subscriptions exactly once. */
  start() {
    this.active = true;
    const identity = `${this.props.sessionId}:${this.props.projectId}`;
    const epoch = this.props.boundary.epoch;
    this.retire(identity !== this.identity || epoch !== this.epoch);
    this.identity = identity;
    this.epoch = epoch;
    if (!this.current()) return;
    const subscription = ++this.subscription;
    // Events during bootstrap retire metadata already being fetched.
    void onProjectsChanged((event) => {
      if (
        !this.current() ||
        subscription !== this.subscription ||
        event.projectId !== this.props.projectId
      )
        return;
      this.retire();
      if (event.change === "removed") {
        this.state.blocked = true;
        this.state.errorCode = "projectNotFound";
        this.emit();
        this.props.onProjectMissing();
      } else if (this.subscribed) void this.bootstrap();
    })
      .then((detach) => {
        if (!this.current() || subscription !== this.subscription) {
          detach();
          return;
        }
        this.detach = detach;
        this.subscribed = true;
        if (!this.state.blocked) void this.bootstrap();
      })
      .catch(() => {
        if (!this.current() || subscription !== this.subscription) return;
        this.state.error = "Could not monitor project changes. Try again.";
        this.emit();
      });
  }
  /** Stop subscription and queued work while retaining only route intent. */
  stop() {
    this.active = false;
    this.subscription++;
    this.detach?.();
    this.detach = undefined;
    this.subscribed = false;
    this.retire();
  }
  /** Read authoritative project metadata before any scan or refresh. */
  async bootstrap(stale?: Map<string, FileBranchState>, searchOnly = false) {
    const generation = this.generation;
    if (!this.current(generation)) return;
    this.bootstrapping = true;
    try {
      const project = await getProject(this.props.projectId);
      if (!this.current(generation)) return;
      if (this.root !== null && this.root !== project.rootPath) {
        this.state.query = "";
        this.state.expanded = new Set();
        stale = undefined;
        searchOnly = false;
      }
      this.root = project.rootPath;
      this.state.project = project;
      if (project.availability.status !== "available") {
        this.state.error = "Project folder is unavailable.";
        this.state.blocked = true;
        this.emit();
        return;
      }
      if (stale) {
        // Old cursors are never reusable after a fresh scan.
        this.state.branches = new Map(
          [...stale].map(([path, branch]) => [
            path,
            { ...branch, nextCursor: null, stale: true, status: "ready" as const },
          ]),
        );
      }
      this.emit();
      if (!searchOnly) this.list("", null);
      this.scheduleSearch();
    } catch (error) {
      if (!this.current(generation)) return;
      this.state.project = null;
      this.state.branches = new Map();
      this.handleError(error);
      this.emit();
    } finally {
      if (this.current(generation)) {
        this.bootstrapping = false;
        this.finishRefresh();
      }
    }
  }
  /** Queue useful work without exceeding two scans or duplicating a directory. */
  enqueue(scan: Scan) {
    this.queue = this.queue.filter((pending) => pending.valid() && pending.key !== scan.key);
    this.queue.push(scan);
    this.pump();
  }
  /** Keep obsolete IPC in the capacity count until its actual promise settles. */
  pump() {
    this.queue = this.queue.filter((scan) => scan.valid());
    while (this.running.size < 2) {
      const index = this.queue.findIndex((scan) => !this.running.has(scan.key));
      if (index < 0) break;
      const [scan] = this.queue.splice(index, 1);
      this.running.add(scan.key);
      // Each run handles public failures and always releases the real occupied slot.
      void scan.run().finally(() => {
        this.running.delete(scan.key);
        this.pump();
        this.finishRefresh();
      });
    }
  }
  /** Coalesce repeated refresh presses into at most one follow-up refresh. */
  finishRefresh() {
    if (
      !this.refreshPending ||
      this.bootstrapping ||
      this.timer !== undefined ||
      this.queue.length ||
      this.running.size
    )
      return;
    this.refreshPending = false;
    if (this.refreshAgain && this.current()) {
      this.refreshAgain = false;
      this.refresh();
    }
  }
  /** Load a single branch page with exact identity, token, cursor, and capacity guards. */
  list(directory: string, cursor: string | null, recovery = false) {
    if (!this.current() || this.state.blocked || !this.state.project) return;
    if (directory && !this.state.expanded.has(directory)) return;
    const existing = this.state.branches.get(directory);
    if (existing?.status === "loading") return;
    const generation = this.generation;
    const token = (this.branchTokens.get(directory) ?? 0) + 1;
    this.branchTokens.set(directory, token);
    const branch: FileBranchState = {
      entries: existing?.entries ?? [],
      nextCursor: existing?.nextCursor ?? null,
      status: "loading",
      stale: existing?.stale ?? false,
      lastPage: existing?.lastPage ?? null,
      error: null,
    };
    this.state.branches.set(directory, branch);
    this.emit();
    // A collapsed and re-expanded directory must not accept its first expansion's response.
    const valid = () =>
      this.current(generation) &&
      this.branchTokens.get(directory) === token &&
      (!directory || this.state.expanded.has(directory));
    this.enqueue({
      key: `list:${directory}`,
      generation,
      valid,
      run: async () => {
        try {
          const page = await listFileChildren({
            projectId: this.props.projectId,
            directory,
            cursor,
          });
          if (!valid()) return;
          const entries = new Map(
            (cursor === null ? [] : branch.entries).map((entry) => [entry.relativePath, entry]),
          );
          for (const entry of page.entries) entries.set(entry.relativePath, entry);
          const count =
            [...this.state.branches.values()].reduce(
              (total, current) => total + current.entries.length,
              0,
            ) -
            branch.entries.length +
            entries.size;
          if (count > 5000) {
            branch.status = "ready";
            this.state.limited = true;
            this.emit();
            return;
          }
          this.state.branches.set(directory, {
            entries: [...entries.values()],
            nextCursor: page.nextCursor,
            lastPage: page,
            status: "ready",
            stale: false,
            error: null,
          });
          this.prune();
          this.emit();
          for (const entry of page.entries) {
            if (
              entry.kind === "directory" &&
              this.state.expanded.has(entry.relativePath) &&
              (!this.state.branches.has(entry.relativePath) ||
                this.state.branches.get(entry.relativePath)?.stale)
            )
              this.list(entry.relativePath, null);
          }
        } catch (error) {
          if (!valid()) return;
          branch.status = "error";
          branch.error = fileErrorCopy(error);
          branch.stale = branch.entries.length > 0;
          const code = fileErrorCode(error);
          if (code === "invalidCursor" && !recovery) {
            this.state.branches.delete(directory);
            this.list(directory, null, true);
          } else if (
            [
              "entryNotFound",
              "entryNotVisible",
              "notDirectory",
              "linkTraversalDenied",
              "invalidRelativePath",
            ].includes(code ?? "") &&
            !recovery &&
            directory
          ) {
            this.removeEntry(directory);
            this.list(parentPath(directory), null, true);
          } else this.handleError(error);
          this.emit();
        }
      },
    });
  }
  /** Retain only branches whose ancestors remain visible in loaded pages. */
  prune() {
    const visible = new Set<string>();
    const directories = new Set<string>();
    // Visit only expanded children of accepted pages, never eagerly scan them.
    const visit = (path: string) => {
      for (const entry of this.state.branches.get(path)?.entries ?? []) {
        visible.add(entry.relativePath);
        if (entry.kind === "directory") {
          directories.add(entry.relativePath);
          if (this.state.expanded.has(entry.relativePath)) visit(entry.relativePath);
        }
      }
    };
    visit("");
    for (const path of this.state.branches.keys())
      if (path && (!directories.has(path) || !this.state.expanded.has(path))) {
        this.state.branches.delete(path);
        this.branchTokens.set(path, (this.branchTokens.get(path) ?? 0) + 1);
      }
    if (this.state.selectedPath && !visible.has(this.state.selectedPath))
      this.state.selectedPath = null;
  }
  /** Collapse releases descendant data and invalidates pending branch completions. */
  toggleDirectory = (path: string) => {
    if (!this.current() || this.state.blocked) return;
    if (this.state.expanded.has(path)) {
      for (const item of this.state.expanded)
        if (item === path || item.startsWith(`${path}/`)) this.state.expanded.delete(item);
      for (const item of this.state.branches.keys())
        if (item === path || item.startsWith(`${path}/`)) {
          this.state.branches.delete(item);
          this.branchTokens.set(item, (this.branchTokens.get(item) ?? 0) + 1);
        }
      if (this.state.selectedPath?.startsWith(`${path}/`)) this.state.selectedPath = path;
      this.state.limited = false;
      this.emit();
    } else {
      this.state.expanded.add(path);
      this.list(path, null);
    }
  };
  /** Release all descendants while retaining the accepted root page. */
  collapseAll = () => {
    if (!this.current()) return;
    for (const path of [...this.state.expanded])
      if (this.state.expanded.has(path)) this.toggleDirectory(path);
  };
  /** Read only the opaque continuation belonging to this directory snapshot. */
  loadMore = (directory: string) => {
    const branch = this.state.branches.get(directory);
    if (branch?.nextCursor) this.list(directory, branch.nextCursor);
  };
  /** Retire obsolete query results immediately, even before debounce expires. */
  setQuery = (query: string) => {
    if (!this.current()) return;
    this.state.query = query;
    this.state.selectedPath = null;
    this.state.search = null;
    this.state.actionError = "";
    this.scheduleSearch();
    if ((!query.trim() || !validFilter(query.trim())) && this.treeStale) {
      this.treeStale = false;
      this.refresh();
    }
  };
  /** Delay scans until the IME has committed its final text. */
  setComposing = (composing: boolean) => {
    this.composing = composing;
    this.scheduleSearch();
  };
  /** Debounce one latest valid basename query with a separate search token. */
  scheduleSearch() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const token = ++this.queryToken;
    const query = this.state.query.trim();
    this.state.validation = validFilter(query) ? "" : INVALID_FILTER;
    this.state.searchStatus = query && !this.state.validation ? "loading" : "idle";
    this.emit();
    if (!query || this.state.validation || this.composing || !this.state.project) return;
    // Capture this draft so an earlier scan cannot publish under newer input.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.search(query, token);
    }, 250);
  }
  /** Serialize searches behind the previous search while sharing the two-scan budget. */
  search(query: string, token: number, recovery = false) {
    const generation = this.generation;
    const valid = () =>
      this.current(generation) &&
      this.queryToken === token &&
      !this.composing &&
      this.state.query.trim() === query;
    if (!valid()) return;
    // Recovery reads also retire old rows immediately, not only debounced input changes.
    this.state.search = null;
    this.state.searchStatus = "loading";
    this.state.selectedPath = null;
    this.emit();
    this.enqueue({
      key: "search",
      generation,
      valid,
      run: async () => {
        try {
          const result = await searchFileTree({ projectId: this.props.projectId, query });
          if (!valid()) return;
          this.state.search = { ...result, matches: result.matches.slice(0, 200) };
          this.state.searchStatus = "ready";
        } catch (error) {
          if (!valid()) return;
          this.state.searchStatus = "error";
          if (fileErrorCode(error) === "invalidSearch") {
            this.state.validation = INVALID_FILTER;
            this.state.searchStatus = "idle";
          } else if (
            ["entryNotFound", "entryNotVisible"].includes(fileErrorCode(error) ?? "") &&
            !recovery
          )
            this.search(query, token, true);
          else this.handleError(error, true);
        }
        if (valid()) this.emit();
      },
    });
  }
  /** Refresh metadata and current view, preserving stale rows only for a confirmed same root. */
  refresh = () => {
    if (!this.current()) return;
    if (!this.subscribed) {
      this.stop();
      this.start();
      return;
    }
    if (this.refreshPending) {
      this.refreshAgain = true;
      return;
    }
    const searching = !!this.state.query.trim() && !this.state.validation;
    const branches = this.state.branches;
    this.retire();
    this.refreshPending = true;
    this.rootRecovery = false;
    this.treeStale = searching;
    void this.bootstrap(branches, searching);
  };
  /** Select only DTO identities currently displayed in the active view. */
  select = (path: string) => {
    if (this.current() && !this.state.blocked) {
      this.state.selectedPath = path;
      this.emit();
    }
  };
  /** Remove a stale entry and all of its descendants before targeted recovery. */
  removeEntry(path: string) {
    if (this.state.expanded.has(path)) this.toggleDirectory(path);
    for (const branch of this.state.branches.values())
      branch.entries = branch.entries.filter((entry) => entry.relativePath !== path);
    this.state.selectedPath = null;
  }
  /** Handle project-wide failures without retrying side effects or looping recovery reads. */
  handleError(error: unknown, search = false) {
    const sourceCode = fileErrorCode(error);
    // Projects uses different public spellings for the same bootstrap barriers.
    const code =
      sourceCode === "removalInProgress"
        ? "projectRemovalInProgress"
        : sourceCode === "unauthorizedWindow"
          ? "windowNotAllowed"
          : sourceCode;
    this.state.error = fileErrorCopy(error, search);
    this.state.errorCode = code;
    if (code === "projectRootChanged") {
      const recover = !this.rootRecovery;
      this.retire(true);
      this.rootRecovery = true;
      this.state.error = fileErrorCopy(error);
      if (recover) void this.bootstrap();
    } else if (
      [
        "projectNotFound",
        "projectUnavailable",
        "projectRemovalInProgress",
        "invalidProjectId",
        "windowNotAllowed",
      ].includes(code ?? "")
    ) {
      this.retire();
      this.state.error = fileErrorCopy(error, search);
      this.state.errorCode = code;
      this.state.blocked = true;
      if (code === "projectNotFound" && this.current()) this.props.onProjectMissing();
    }
    this.emit();
  }
  /** Revalidate every action and check the live boundary again before clipboard writes. */
  action = async (kind: "copyAbsolute" | "copyRelative" | "reveal", entry: FileTreeEntryDto) => {
    if (
      !this.current() ||
      this.state.blocked ||
      this.actionRunning ||
      (kind === "reveal" && entry.kind === "symbolicLink")
    )
      return;
    const visible =
      this.state.search?.matches ??
      [...this.state.branches.values()].flatMap((branch) => branch.entries);
    if (!visible.some((item) => item.relativePath === entry.relativePath)) return;
    const generation = this.generation;
    this.actionRunning = true;
    this.state.pendingAction = true;
    this.state.actionError = "";
    this.state.feedback = "";
    this.emit();
    try {
      const request = { projectId: this.props.projectId, relativePath: entry.relativePath };
      if (kind === "reveal") await revealFileEntry(request);
      else {
        const paths = await getFileEntryPaths(request);
        if (!this.current(generation)) return;
        try {
          await navigator.clipboard.writeText(
            kind === "copyAbsolute" ? paths.absolutePath : paths.relativePath,
          );
        } catch {
          if (this.current(generation)) this.state.actionError = "Could not copy path. Try again.";
          return;
        }
      }
      if (this.current(generation))
        this.state.feedback =
          kind === "reveal"
            ? "Entry revealed."
            : kind === "copyAbsolute"
              ? "Path copied."
              : "Relative path copied.";
    } catch (error) {
      if (!this.current(generation)) return;
      this.state.actionError = fileErrorCopy(error);
      const code = fileErrorCode(error);
      if (
        [
          "entryNotFound",
          "entryNotVisible",
          "invalidRelativePath",
          "notDirectory",
          "linkTraversalDenied",
        ].includes(code ?? "")
      ) {
        this.removeEntry(entry.relativePath);
        if (this.state.query.trim() && !this.state.validation)
          this.search(this.state.query.trim(), this.queryToken, true);
        else this.list(parentPath(entry.relativePath), null, true);
      } else if (code !== "revealFailed") this.handleError(error);
    } finally {
      this.actionRunning = false;
      if (this.current()) this.emit();
    }
  };
}
/** Return the relative parent without interpreting paths as native filesystem input. */
export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/** Bind one private coordinator to the route and synchronously expose current owner props. */
export function useFileExplorer(props: FileExplorerProps) {
  const [state, setState] = useState(initialState);
  const controller = useRef<ExplorerController | null>(null);
  if (!controller.current) controller.current = new ExplorerController(props, setState);
  const owner = controller.current;
  owner.props = props;
  // Only lifecycle identity changes restart subscription; tab changes never participate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: The controller reads live props; these dependencies delimit its lifecycle.
  useEffect(() => {
    owner.start();
    return () => owner.stop();
  }, [
    owner,
    props.sessionId,
    props.projectId,
    props.isVisible,
    props.boundary.epoch,
    props.boundary.suspended,
  ]);
  const current = owner.current();
  return { state: current ? state : { ...initialState(), blocked: true }, owner, current };
}
