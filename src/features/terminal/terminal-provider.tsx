import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { TerminalRegistry } from "./terminal-registry";

const TerminalRegistryContext = createContext<TerminalRegistry | null>(null);

/** Owns all terminal resources independently of mounted routes and pane views. */
export function TerminalProvider(props: { children: ReactNode }) {
  const registry = useRef<TerminalRegistry | null>(null);
  if (registry.current === null) registry.current = new TerminalRegistry();

  useEffect(() => {
    const current = registry.current;
    current?.startMonitoring();
    return () => current?.stopMonitoring();
  }, []);

  return (
    <TerminalRegistryContext.Provider value={registry.current}>
      {props.children}
    </TerminalRegistryContext.Provider>
  );
}

/** Reads the root registry and fails clearly when app composition omitted its provider. */
export function useTerminalRegistry(): TerminalRegistry {
  const registry = useContext(TerminalRegistryContext);
  if (registry === null) throw new Error("TerminalProvider is missing from app composition.");
  return registry;
}
