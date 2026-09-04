import { useEffect } from "react";
import { Outlet } from "react-router";
import { SettingsNav } from "./settings-nav";
import { retainSettingsArea, useSettingsStore } from "./settings-store";

/** Keep one Settings frame mounted around every child route and own its initial snapshot read. */
export function SettingsRoute() {
  const load = useSettingsStore((state) => state.load);

  useEffect(() => {
    const release = retainSettingsArea();
    if (useSettingsStore.getState().status === "idle") {
      void load();
    }
    return release;
  }, [load]);

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[220px_minmax(0,1fr)]">
      <SettingsNav />
      <div className="min-h-0 min-w-0 overflow-y-auto px-10 py-7">
        <Outlet />
      </div>
    </div>
  );
}
