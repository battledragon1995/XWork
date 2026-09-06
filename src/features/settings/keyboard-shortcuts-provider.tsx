import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createKeyboardShortcutsState,
  type KeyboardShortcutsState,
} from "./keyboard-shortcuts-state";

const Context = createContext<KeyboardShortcutsState | null>(null);
/** Mount a fresh coordinator per effect lifetime, including StrictMode replay. */
export function KeyboardShortcutsProvider(props: { children: React.ReactNode }) {
  const [store, setStore] = useState(createKeyboardShortcutsState);
  const initialStore = useRef(store);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Start one live coordinator and retire the initial render-only instance.
  useEffect(() => {
    initialStore.current.dispose();
    const active = createKeyboardShortcutsState();
    setStore(active);
    /** Reconcile when the native window returns to the foreground. */
    const refresh = () => {
      void active.getSnapshot().refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    /** Retire this generation without pretending to cancel backend commits. */
    return () => {
      window.removeEventListener("focus", refresh);
      active.dispose();
    };
  }, []);
  return <Context.Provider value={state}>{props.children}</Context.Provider>;
}
/** Read the public Settings snapshot and narrow actions at the composition root. */
export function useKeyboardShortcuts(): KeyboardShortcutsState {
  const state = useContext(Context);
  if (state === null) throw new Error("KeyboardShortcutsProvider is required");
  return state;
}
