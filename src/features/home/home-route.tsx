import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { HomeScreen, QueryNotice } from "./home-screen";
import { useProjectPresence } from "./use-project-presence";
import { WelcomeScreen } from "./welcome-screen";

export interface HomeBoundarySnapshot {
  suspended: boolean;
  epoch: number;
}
export interface HomeRouteProps {
  boundary?: HomeBoundarySnapshot;
  readBoundary?(): HomeBoundarySnapshot;
}

/** Select Home or Welcome from the same authoritative, maintenance-aware project snapshot. */
export function HomeRoute(props: HomeRouteProps = {}) {
  const projects = useProjectPresence(props);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  useLayoutEffect(
    /** Transfer focus only when the previously focused branch disappears. */ () => {
      if (
        focused.current &&
        !focused.current.isConnected &&
        document.activeElement === document.body
      ) {
        const heading = root.current?.querySelector<HTMLElement>("h1");
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
        focused.current = null;
      }
    },
  );
  const { presence } = projects;
  return (
    <div
      ref={root}
      className="h-full"
      onFocusCapture={
        /** Remember only focus owned by the disappearing branch. */ (event) => {
          focused.current = event.target;
        }
      }
    >
      {presence.status === "loading" ? (
        <div role="status" aria-busy="true" className="h-full">
          <span className="sr-only">Checking your projects…</span>
        </div>
      ) : presence.status === "empty" ? (
        <>
          {(projects.failure || projects.subscriptionFailed) && (
            <div className="px-8 pt-4">
              <QueryNotice
                query={projects}
                owner="Projects"
                suspended={props.boundary?.suspended ?? false}
              />
            </div>
          )}
          <WelcomeScreen />
        </>
      ) : presence.status === "present" ? (
        <HomeScreen {...props} projects={projects} />
      ) : (
        <div
          role="alert"
          className="flex h-full flex-col items-start justify-center gap-3 px-8 py-7 text-[15px] text-body"
        >
          <p>
            {presence.kind === "retryable"
              ? "XWork couldn't load your projects."
              : "XWork ran into a problem it cannot recover from. Restart XWork."}
          </p>
          {presence.kind === "retryable" && (
            <Button
              disabled={projects.refreshing || props.boundary?.suspended}
              onClick={projects.refresh}
            >
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
