import { useMatches, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import type { RouteCrumbHandle } from "./app-router";

// Name the area that failed by reading the crumbs of the deepest match that declares them.
// The router keeps the errored match in place, so this still resolves while the boundary renders.
function useFailingAreaName(): string | null {
  const matches = useMatches();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const handle = match?.handle as RouteCrumbHandle | undefined;
    const area = handle?.crumbs(match?.params ?? {})[0];

    if (area) {
      return area;
    }
  }

  return null;
}

// Replace only the failing route's content so the topbar and sidebar stay usable.
export function AppErrorBoundary() {
  const navigate = useNavigate();
  const area = useFailingAreaName();

  return (
    <div className="flex h-full flex-col items-start justify-center gap-3 px-8 py-7" role="alert">
      <h1 className="font-display text-[36px] leading-tight tracking-tight text-ink">
        Something went wrong
      </h1>
      <p className="max-w-[440px] text-[15px] text-body">
        {area === null
          ? "This area could not be displayed."
          : `The ${area} area could not be displayed.`}
      </p>
      <Button className="mt-2" onClick={() => void navigate("/")}>
        Go to Home
      </Button>
    </div>
  );
}
