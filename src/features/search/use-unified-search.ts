import { useCallback, useEffect, useRef, useState } from "react";
import type { UnifiedSearchError, UnifiedSearchResponseDto } from "@/bindings/search";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { searchUnified } from "@/lib/ipc/search";

/** Coordinate a single transient query lifetime; Rust requests themselves cannot be cancelled. */
export function useUnifiedSearch(props: {
  open: boolean;
  contextProjectId: string | null;
  contextReady: boolean;
  refreshKey: number;
}) {
  const [query, updateQuery] = useState("");
  const [composing, updateComposing] = useState(false);
  const queryValue = useRef("");
  const compositionValue = useRef(false);
  const [revision, setRevision] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [result, setResult] = useState<{
    response: UnifiedSearchResponseDto | null;
    error: IpcCallError<UnifiedSearchError> | null;
    identity: string;
    status: "idle" | "loading" | "ready" | "error";
  }>({ response: null, error: null, identity: "", status: "idle" });
  const generation = useRef(0);
  const immediate = useRef(true);
  const startedIdentity = useRef<string | null>(null);
  const previous = useRef({
    open: false,
    context: props.contextProjectId,
    refresh: props.refreshKey,
  });
  const identity = JSON.stringify([
    props.open,
    props.contextProjectId,
    props.contextReady,
    props.refreshKey,
    query,
    composing,
    revision,
    fallback,
  ]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  /** Invalidate synchronously, before a debounced request can be scheduled. */
  const setQuery = useCallback((value: string) => {
    if (queryValue.current === value) return;
    queryValue.current = value;
    generation.current += 1;
    immediate.current = false;
    updateQuery(value);
  }, []);
  /** Suspend requests during composition and debounce the committed value. */
  const setComposing = useCallback((value: boolean) => {
    if (compositionValue.current === value) return;
    compositionValue.current = value;
    generation.current += 1;
    immediate.current = false;
    updateComposing(value);
  }, []);
  /** Refresh reads explicitly without ever repeating an owner mutation. */
  const retry = useCallback(() => {
    generation.current += 1;
    immediate.current = true;
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const prior = previous.current;
    previous.current = {
      open: props.open,
      context: props.contextProjectId,
      refresh: props.refreshKey,
    };
    const request = ++generation.current;
    if (!props.open) {
      queryValue.current = "";
      compositionValue.current = false;
      updateQuery("");
      updateComposing(false);
      setFallback(false);
      immediate.current = true;
      setResult({ response: null, error: null, identity: "", status: "idle" });
      return;
    }
    if (!props.contextReady || composing) return;
    const now =
      immediate.current ||
      startedIdentity.current === identity ||
      !prior.open ||
      prior.context !== props.contextProjectId ||
      prior.refresh !== props.refreshKey;
    immediate.current = false;
    /** Publish only while both request generation and rendered inputs remain current. */
    const valid = () => generation.current === request && currentIdentity.current === identity;
    /** Execute a typed read after the optional typing delay. */
    const run = async () => {
      startedIdentity.current = identity;
      setResult({ response: null, error: null, status: "loading", identity });
      try {
        const response = await searchUnified({
          query,
          contextProjectId: fallback ? null : props.contextProjectId,
        });
        if (valid()) setResult({ response, error: null, status: "ready", identity });
      } catch (cause) {
        const error =
          cause instanceof IpcCallError
            ? (cause as IpcCallError<UnifiedSearchError>)
            : new IpcCallError<UnifiedSearchError>("search_unified", null);
        if (valid()) setResult({ response: null, error, status: "error", identity });
      }
    };
    const timer = now ? null : window.setTimeout(run, 120);
    if (now) void run();
    /** Retire timers and promises on close, changed input, unmount and StrictMode replay. */
    return () => {
      generation.current += 1;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    props.open,
    props.contextReady,
    props.contextProjectId,
    props.refreshKey,
    query,
    composing,
    identity,
    fallback,
  ]);
  useEffect(() => {
    if (!props.open) return;
    window.addEventListener("focus", retry);
    /** Release the one focus refresh listener for this open lifetime. */
    return () => window.removeEventListener("focus", retry);
  }, [props.open, retry]);
  /** Switch an invalid context to global search only on an explicit retry. */
  function retrySearch() {
    if (result.error?.payload?.code === "invalid_context_project_id") setFallback(true);
    retry();
  }
  const current = result.identity === identity && props.contextReady && !composing;
  return {
    query,
    setQuery,
    composing,
    setComposing,
    retry: retrySearch,
    response: current ? result.response : null,
    error: current ? result.error : null,
    status: !props.open ? ("idle" as const) : current ? result.status : ("loading" as const),
  };
}
