import { type ReactNode, useEffect, useRef } from "react";
import { FileHandleRegistryContext } from "./file-handle-context";
import { FileHandleRegistry } from "./file-handle-registry";

/** Composition seam so tests can supply an isolated registry without native transport. */
export interface FileHandleProviderProps {
  children: ReactNode;
  createRegistry?: () => FileHandleRegistry;
}

/** Owns every open file handle independently of mounted routes and pane views. */
export function FileHandleProvider(props: FileHandleProviderProps) {
  const registry = useRef<FileHandleRegistry | null>(null);
  if (registry.current === null) {
    registry.current = props.createRegistry?.() ?? new FileHandleRegistry();
  }

  useEffect(() => {
    const current = registry.current;
    current?.startMonitoring();
    return () => current?.stopMonitoring();
  }, []);

  return (
    <FileHandleRegistryContext.Provider value={registry.current}>
      {props.children}
    </FileHandleRegistryContext.Provider>
  );
}
