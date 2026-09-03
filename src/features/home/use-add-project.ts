import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import type { InvalidProjectFolderReasonDto, ProjectsError } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { addProject as addProjectCommand } from "@/lib/ipc/projects";

/** One failed attempt to register a folder, plus the recovery it allows. */
export type AddProjectFailure =
  | { kind: "retryable"; message: string }
  | { kind: "duplicate"; message: string; projectId: string }
  | { kind: "integration"; message: string };

/** What the Welcome screen reads from the flow: its phase, its failure and its one action. */
export interface AddProjectResult {
  status: "idle" | "pending";
  failure: AddProjectFailure | null;
  addProject(): Promise<void>;
}

/** Copy for a failure the user cannot retry, only restart out of. */
const INTEGRATION_MESSAGE = "XWork ran into a problem it cannot recover from. Restart XWork.";
/** Copy shared by the two failures that happen after a folder was already accepted. */
const SAVE_FAILED_MESSAGE = "XWork couldn't save the project. Try again.";
/** Copy shared by the three reasons that describe an unusable path rather than a bad folder. */
const UNUSABLE_PATH_MESSAGE = "XWork can't use that folder's path. Pick another folder.";

/** One message per generated invalid-folder reason, so a new reason cannot go unhandled. */
const INVALID_FOLDER_MESSAGES: Record<InvalidProjectFolderReasonDto, string> = {
  missing: "That folder no longer exists. Pick another folder.",
  notDirectory: "That path is a file, not a folder. Pick a folder.",
  fileSystemRoot: "A drive root can't be a project. Pick a folder inside it.",
  accessDenied: "XWork can't read that folder. Check its permissions or pick another folder.",
  notAbsolute: UNUSABLE_PATH_MESSAGE,
  notUtf8: UNUSABLE_PATH_MESSAGE,
  cannotCanonicalize: UNUSABLE_PATH_MESSAGE,
};

// Read the tagged Projects payload out of one rejection. Anything the adapter could not
// recognize stays `null` and is treated as unrecoverable rather than guessed at.
function projectsErrorOf(rejection: unknown): ProjectsError | null {
  return rejection instanceof IpcCallError ? (rejection.payload as ProjectsError | null) : null;
}

// Turn one rejection into the message and recovery the screen should offer.
function describeFailure(rejection: unknown): AddProjectFailure {
  const error = projectsErrorOf(rejection);

  switch (error?.code) {
    case "folderPickerFailed":
      return { kind: "retryable", message: "XWork couldn't open the folder picker. Try again." };
    case "invalidProjectFolder":
      return { kind: "retryable", message: INVALID_FOLDER_MESSAGES[error.reason] };
    case "invalidDisplayName":
      return {
        kind: "retryable",
        message: "XWork couldn't use that folder's name. Pick a different folder.",
      };
    case "projectAlreadyExists":
      // `project_id` is the generated snake_case field. Renaming it here would silently
      // navigate to `undefined` instead of the project that already owns the folder.
      return {
        kind: "duplicate",
        message: "That folder is already a project in XWork.",
        projectId: error.project_id,
      };
    case "clockFailed":
    case "persistenceFailed":
      return { kind: "retryable", message: SAVE_FAILED_MESSAGE };
    default:
      return { kind: "integration", message: INTEGRATION_MESSAGE };
  }
}

/**
 * Drive the one Add Project attempt Welcome can have in flight. The backend owns the native
 * picker and every validation rule, so this hook only sequences the call, classifies its
 * outcome and navigates once a project exists.
 */
export function useAddProject(options: { onCancelled(): void }): AddProjectResult {
  const [status, setStatus] = useState<"idle" | "pending">("idle");
  const [failure, setFailure] = useState<AddProjectFailure | null>(null);
  const navigate = useNavigate();
  const { onCancelled } = options;

  // A ref, not `status`, guards re-entry: two clicks in the same tick both read the state
  // from before the first render, and only a synchronous flag can stop the second picker.
  const isPending = useRef(false);

  // Every attempt carries a token. Unmount invalidates it, so a picker that closes after the
  // route is gone updates no state and moves no focus.
  const requestToken = useRef(0);

  useEffect(() => {
    return () => {
      requestToken.current += 1;
    };
  }, []);

  // Return to the idle phase and publish the failure, if the attempt is still the current one.
  const settle = useCallback((token: number, result: AddProjectFailure | null): boolean => {
    if (token !== requestToken.current) {
      return false;
    }

    isPending.current = false;
    // Flushed on purpose: the caller restores focus to the primary button right after, and a
    // still-disabled button cannot take focus.
    flushSync(() => {
      setStatus("idle");
      setFailure(result);
    });

    return true;
  }, []);

  const addProject = useCallback(async () => {
    if (isPending.current) {
      return;
    }

    isPending.current = true;
    requestToken.current += 1;
    const token = requestToken.current;
    setStatus("pending");
    setFailure(null);

    try {
      const selection = await addProjectCommand();

      if (!settle(token, null)) {
        return;
      }

      if (selection.outcome === "selected") {
        // `open_project` belongs to Project Overview; the backend already stamped the new row.
        void navigate(`/projects/${selection.project.id}`);
        return;
      }

      onCancelled();
    } catch (rejection: unknown) {
      settle(token, describeFailure(rejection));
    }
  }, [navigate, onCancelled, settle]);

  return { status, failure, addProject };
}
