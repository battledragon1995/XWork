import { createContext, useContext } from "react";
import type { FileHandleRegistry } from "./file-handle-registry";

/** Shared registry context whose identity remains stable across provider Fast Refresh updates. */
export const FileHandleRegistryContext = createContext<FileHandleRegistry | null>(null);

/** Reads the root registry and fails clearly when app composition omitted its provider. */
export function useFileHandleRegistry(): FileHandleRegistry {
  const registry = useContext(FileHandleRegistryContext);
  if (registry === null) throw new Error("FileHandleProvider is missing from app composition.");
  return registry;
}

/** Expose renderer-only maintenance actions through the existing registry identity. */
export function useFileDataBoundary(): {
  clearAfterReset(): void;
  reconcileAfterResetFailure(): void;
} {
  const registry = useFileHandleRegistry();
  return {
    /** Drop retained handles only after a committed reset. */
    clearAfterReset: () => registry.clearAfterReset(),
    /** Re-read retained handles without optimistic deletion. */
    reconcileAfterResetFailure: () => registry.reconcileAfterResetFailure(),
  };
}
