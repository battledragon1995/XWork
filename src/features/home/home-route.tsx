import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { HomePlaceholder } from "./home-placeholder";
import { type ProjectPresence, useProjectPresence } from "./use-project-presence";
import { WelcomeScreen } from "./welcome-screen";

/** Copy for the one load failure worth another attempt. */
const LOAD_FAILED_MESSAGE = "XWork couldn't load your projects.";
/** Copy for a failure the user cannot retry, only restart out of. */
const INTEGRATION_MESSAGE = "XWork ran into a problem it cannot recover from. Restart XWork.";

// Fill the content area with a failure the route cannot render around. Neither branch is
// guessed at here: without a trustworthy answer, showing Welcome would suggest the user has
// no projects and showing Home would suggest they do.
function LoadFailure(props: { message: string; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-start justify-center gap-3 px-8 py-7 text-[15px] text-body"
    >
      <p>{props.message}</p>
      {props.action}
    </div>
  );
}

/**
 * The entry point of `/`. It renders whichever branch the current project data calls for, and
 * owns no project state itself. FE-003 replaces the Home branch from inside this feature
 * without touching the route table.
 */
export function HomeRoute() {
  const { presence, refresh } = useProjectPresence();

  // Presentation only: remember which presence a retry was started from. Every published
  // result is a fresh object, so the lock releases itself on the next one whatever it says,
  // and one frustrated user cannot queue several loads of the same list.
  const [retriedPresence, setRetriedPresence] = useState<ProjectPresence | null>(null);
  const isRetrying = retriedPresence === presence;

  switch (presence.status) {
    case "loading":
      // First load only. A refresh keeps the branch already on screen, so this state cannot
      // flash between Welcome and Home.
      return (
        <div role="status" aria-busy="true" className="h-full">
          <span className="sr-only">Checking your projects…</span>
        </div>
      );

    case "empty":
      return <WelcomeScreen />;

    case "present":
      return <HomePlaceholder />;

    case "failed":
      return presence.kind === "retryable" ? (
        <LoadFailure
          message={LOAD_FAILED_MESSAGE}
          action={
            <Button
              disabled={isRetrying}
              onClick={() => {
                setRetriedPresence(presence);
                refresh();
              }}
            >
              Try again
            </Button>
          }
        />
      ) : (
        <LoadFailure message={INTEGRATION_MESSAGE} />
      );
  }
}
