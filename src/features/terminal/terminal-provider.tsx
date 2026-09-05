import { useEffect, useRef, type ReactNode } from "react";
import { TerminalRegistryContext } from "./terminal-context";
import { TerminalRegistry } from "./terminal-registry";

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
