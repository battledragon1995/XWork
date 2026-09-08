import type { CloseTargetDto } from "@/bindings/sessions/sessions";
/** Frontend-only selection of producer entries affected by an operation. */
export type FileEditScope =
  | CloseTargetDto
  | { kind: "project"; projectId: string }
  | { kind: "all" };
/** Callbacks keep draft ownership entirely inside the Files producer. */
export interface FileEditCallbacks {
  settle(scope: FileEditScope): Promise<() => void>;
  save(scope: FileEditScope): Promise<void>;
  hasPendingEdits(scope: FileEditScope): boolean;
  subscribe(listener: () => void): () => void;
  retire?(scope: FileEditScope): void;
}
/** Construct an isolated bridge; wrapper tests may leave its producer absent. */
export function createFileEditBoundary() {
  let producer: FileEditCallbacks | null = null;
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  /** Relay projection invalidations without storing any draft or dirty authority. */
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** Replace the producer; stale cleanup cannot unregister its successor. */
    register(callbacks: FileEditCallbacks): () => void {
      unsubscribe?.();
      producer = callbacks;
      unsubscribe = callbacks.subscribe(notify);
      notify();
      return () => {
        if (producer !== callbacks) return;
        unsubscribe?.();
        unsubscribe = null;
        producer = null;
        notify();
      };
    },
    /** Report whether the app currently has a Files producer, including a clean editor. */
    isRegistered(): boolean {
      return producer !== null;
    },
    /** Claim producer admission synchronously, then wait for its latest transaction. */
    settle(scope: FileEditScope): Promise<() => void> {
      return producer?.settle(scope) ?? Promise.resolve(() => undefined);
    },
    /** Retire only identities whose lifecycle mutation has succeeded. */
    retire(scope: FileEditScope): void {
      producer?.retire?.(scope);
    },
    /** Ask the producer to save explicit targets in its own ordering. */
    save(scope: FileEditScope): Promise<void> {
      return producer?.save(scope) ?? Promise.resolve();
    },
    /** Read optimistic or acknowledged dirtiness through the producer. */
    hasPendingEdits(scope: FileEditScope): boolean {
      return producer?.hasPendingEdits(scope) ?? false;
    },
    /** Subscribe independently of provider registration order. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
/** App bridge identity; tests create their own bridge for producer behavior. */
export const fileEditBoundary = createFileEditBoundary();
/** Register the Files provider through the public callback-only bridge. */
export const registerFileEditBoundary = fileEditBoundary.register;
/** Hold a lease through the entire command, releasing even after typed failures. */
export async function withFileEditBoundary<T>(
  scope: FileEditScope,
  action: () => Promise<T>,
): Promise<T> {
  let release: () => void;
  try {
    release = await fileEditBoundary.settle(scope);
  } catch (error) {
    throw new FileEditBoundaryError(error);
  }
  try {
    return await action();
  } finally {
    release();
  }
}

/** Preserve the original producer failure while identifying rejected destructive preflight. */
export class FileEditBoundaryError extends Error {
  /** Wrap a typed Files or composition failure without exposing its content. */
  constructor(cause: unknown) {
    super(
      "Could not settle Markdown changes. Cancel to save or resolve the file, then try again.",
      { cause },
    );
    this.name = "FileEditBoundaryError";
  }
}
