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
