import type { TerminalError, TerminalInteractionError } from "@/bindings/terminal/terminal";

/** Maps known terminal errors to safe action-oriented English copy. */
export function terminalErrorCopy(error: TerminalError | TerminalInteractionError | null): string {
  if (error === null) return "XWork couldn't complete the terminal action.";
  switch (error.code) {
    case "clipboardUnavailable":
      return "The clipboard is unavailable. Try again.";
    case "unsupportedClipboardText":
      return "The clipboard has no text.";
    case "invalidLink":
      return "Only HTTP and HTTPS links can be opened.";
    case "linkOpenFailed":
      return "XWork couldn't open this link.";
    case "terminalNotRunning":
      return "This terminal has stopped.";
    case "projectUnavailable":
      return "This project folder is unavailable.";
    case "profileNotFound":
      return "This terminal profile no longer exists.";
    case "profileUnavailable":
      return "This terminal profile is unavailable.";
    default:
      return "XWork couldn't complete the terminal action.";
  }
}
