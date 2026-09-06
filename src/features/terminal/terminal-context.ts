import { createContext, useContext } from "react";
import type { TerminalRegistry } from "./terminal-registry";

/** Shared registry context whose identity remains stable across provider Fast Refresh updates. */
export const TerminalRegistryContext = createContext<TerminalRegistry | null>(null);

/** Reads the root registry and fails clearly when app composition omitted its provider. */
export function useTerminalRegistry(): TerminalRegistry {
  const registry = useContext(TerminalRegistryContext);
  if (registry === null) throw new Error("TerminalProvider is missing from app composition.");
  return registry;
}

/** Expose renderer-only maintenance actions through the existing registry identity. */
export function useTerminalDataBoundary() {
  const registry = useTerminalRegistry();
  return {
    /** Drop renderers only after commit. */
    clearAfterReset: () => registry.clearAfterReset(),
    /** Reconcile actual runtime without optimistic deletion. */
    reconcileAfterResetFailure: () => registry.reconcileAfterResetFailure(),
  };
}
