import { Folder, PenLine } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAddProject } from "./use-add-project";
import { WelcomeArt } from "./welcome-art";

// Absorb every activation of a control whose owning slice has not shipped. Returning at once
// is the whole behavior: no command runs, no navigation happens and focus stays put.
function ignoreActivation(): void {}

// Explain which slice brings one still-unavailable control. The trigger stays a focusable
// `aria-disabled` control rather than a `disabled` one, because a disabled element takes no
// focus and would leave a keyboard user with no way to read this explanation.
function UnavailableAction(props: { tooltip: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{props.children}</TooltipTrigger>
      <TooltipContent>{props.tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The first-run screen: one sentence about XWork, the real Add Project flow, and the two
 * entry points §5.1 requires even though their features arrive later. It owns no project
 * data; the backend registers the folder and this screen only reacts to the outcome.
 */
export function WelcomeScreen() {
  const addProjectButton = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  // The native picker takes focus out of the webview, so cancelling it would otherwise leave
  // focus on the document. Hand it back to the control that opened the dialog.
  const restoreFocus = useCallback(() => {
    addProjectButton.current?.focus();
  }, []);

  const { status, failure, addProject } = useAddProject({ onCancelled: restoreFocus });
  const isPending = status === "pending";

  return (
    <div className="@container h-full">
      <div
        data-slot="welcome-grid"
        className="grid h-full grid-cols-1 items-center gap-12 px-12 @min-[900px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] @min-[900px]:px-24"
      >
        <div>
          <p className="text-[11px] leading-[1.4] font-medium tracking-[1.2px] text-muted uppercase">
            First run
          </p>
          <h1 className="mt-3 max-w-[540px] font-display text-[44px] leading-[1.1] font-medium tracking-[-0.02em] text-ink">
            Every project, every CLI, one window.
          </h1>
          <p className="mt-4 max-w-[440px] text-[15px] text-body">
            XWork keeps Codex, Claude and your terminal side by side, one workspace per project,
            without leaving the keyboard. Everything stays on this machine.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              ref={addProjectButton}
              className="h-10 px-5 text-[14px]"
              disabled={isPending}
              onClick={() => void addProject()}
            >
              <Folder className="size-3.5" />
              {isPending ? "Selecting folder…" : "Add Project"}
            </Button>

            {failure !== null && (
              // Ordered last so it wraps onto its own line beneath the buttons, while staying
              // directly after `Add Project` in the DOM, which is what decides tab order.
              <p
                role="alert"
                className="order-last flex basis-full flex-wrap items-center gap-2 text-[13px] text-error"
              >
                {failure.message}
                {failure.kind === "duplicate" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-brand underline underline-offset-4"
                    onClick={() => void navigate(`/projects/${failure.projectId}`)}
                  >
                    Open project
                  </Button>
                )}
              </p>
            )}

            <UnavailableAction tooltip="Quick Note arrives with FE-020.">
              <Button
                variant="secondary"
                aria-disabled="true"
                onClick={ignoreActivation}
                className="h-10 border border-hairline px-5 text-[14px] text-muted-soft"
              >
                <PenLine className="size-3.5" />
                Open Quick Note
              </Button>
            </UnavailableAction>
          </div>

          <p className="mt-4">
            <UnavailableAction tooltip="Keyboard shortcuts arrive with FE-014.">
              <button
                type="button"
                aria-disabled="true"
                onClick={ignoreActivation}
                className="rounded-xs text-[13px] font-medium text-brand opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                See keyboard shortcuts
              </button>
            </UnavailableAction>
          </p>
        </div>

        <div data-slot="welcome-art-column" className="hidden justify-center @min-[900px]:flex">
          <WelcomeArt />
        </div>
      </div>
    </div>
  );
}
