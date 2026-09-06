import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createDataManagementState,
  type DataCallbacks,
  type DataManagementState,
} from "./data-management-state";

const Context = createContext<DataManagementState | null>(null);
/** Keep a single operation owner across route changes and StrictMode effect replay. */
export function DataManagementProvider(props: DataCallbacks & { children: React.ReactNode }) {
  const current = useRef(props);
  current.current = props;
  const [store] = useState(
    /** Delegate to the newest app callbacks without replacing operations. */ () =>
      createDataManagementState({
        beforeConfirm: /** Acquire current public owner barriers. */ () =>
          current.current.beforeConfirm(),
        onCommitted: /** Reconcile the committed kind. */ (kind) =>
          current.current.onCommitted(kind),
        onResetUncertain: /** Query surviving runtime without clearing it. */ () =>
          current.current.onResetUncertain(),
        refreshViews: /** Retry failed owner reads. */ () => current.current.refreshViews(),
      }),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(
    /** Attach this shell lifetime and retire pending previews on disposal. */ () => {
      store.attach();
      return () => store.dispose();
    },
    [store],
  );
  return <Context.Provider value={state}>{props.children}</Context.Provider>;
}
/** Read the required operation owner inside Settings routes and app composition. */
export function useDataManagement(): DataManagementState {
  const state = useContext(Context);
  if (!state) throw new Error("DataManagementProvider is required");
  return state;
}
/** Allow independently embedded Search/Notifications to operate without a Data host. */
export function useOptionalDataManagement(): DataManagementState | null {
  return useContext(Context);
}
