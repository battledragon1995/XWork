import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";

/** Renders the keyboard-accessible retained-history search controls. */
export function TerminalFindBar(props: {
  query: string;
  searching: boolean;
  matchCount: number;
  activeMatch: number | null;
  onQuery(query: string): void;
  onMove(direction: "next" | "previous"): void;
  onClose(): void;
}) {
  const queryId = useId();
  return (
    <search className="terminal-find-bar">
      <label className="sr-only" htmlFor={queryId}>
        Find in terminal history
      </label>
      <input
        id={queryId}
        ref={(element) => element?.focus()}
        value={props.query}
        placeholder="Find"
        className="terminal-find-input"
        onChange={(event) => props.onQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
          if (event.key === "Enter") props.onMove(event.shiftKey ? "previous" : "next");
        }}
      />
      <span role="status" className="terminal-find-count">
        {props.searching
          ? "Searching…"
          : props.query === ""
            ? "No query"
            : props.matchCount === 0
              ? "No matches"
              : `${(props.activeMatch ?? 0) + 1} of ${props.matchCount}`}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Previous match"
        disabled={props.matchCount === 0}
        onClick={() => props.onMove("previous")}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Next match"
        disabled={props.matchCount === 0}
        onClick={() => props.onMove("next")}
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Close find"
        onClick={props.onClose}
      >
        <X />
      </Button>
    </search>
  );
}
