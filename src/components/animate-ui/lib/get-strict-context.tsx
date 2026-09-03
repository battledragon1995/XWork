import * as React from "react";

// Create a context whose consumers are guaranteed to sit under its provider, so a copied
// Animate UI component fails loudly instead of silently rendering with default values.
function getStrictContext<T>(
  name?: string,
): readonly [
  ({ value, children }: { value: T; children?: React.ReactNode }) => React.JSX.Element,
  () => T,
] {
  const Context = React.createContext<T | undefined>(undefined);

  // Publish one value to the subtree below it.
  const Provider = ({ value, children }: { value: T; children?: React.ReactNode }) => (
    <Context.Provider value={value}>{children}</Context.Provider>
  );

  // Read the published value, or throw when the component is used outside the provider.
  const useSafeContext = () => {
    const ctx = React.useContext(Context);
    if (ctx === undefined) {
      throw new Error(`useContext must be used within ${name ?? "a Provider"}`);
    }
    return ctx;
  };

  return [Provider, useSafeContext] as const;
}

export { getStrictContext };
