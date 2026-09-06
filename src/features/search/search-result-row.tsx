import { Command, Folder, Terminal } from "lucide-react";
import type { SearchResultDto, SearchTextRangeDto } from "@/bindings/search";
import { formatShortcut, type ShortcutPlatform } from "@/lib/utils/keyboard-shortcuts";

export type SearchTargetAvailability = { enabled: boolean; reason: string | null };

/** Render scalar ranges as text nodes, including literal markup and supplementary characters. */
function HighlightText(props: { text: string; ranges: SearchTextRangeDto[] }) {
  const scalars = Array.from(props.text);
  const parts: React.ReactNode[] = [];
  let start = 0;
  for (const range of props.ranges) {
    parts.push(scalars.slice(start, range.startScalar).join(""));
    parts.push(
      <mark key={range.startScalar} className="bg-accent/20 text-inherit">
        {scalars.slice(range.startScalar, range.endScalar).join("")}
      </mark>,
    );
    start = range.endScalar;
  }
  parts.push(scalars.slice(start).join(""));
  return <>{parts}</>;
}

/** Present an option while keeping keyboard focus in the combobox. */
export function SearchResultRow(props: {
  result: SearchResultDto;
  id: string;
  selected: boolean;
  availability: SearchTargetAvailability;
  platform: ShortcutPlatform | null;
  onSelect(): void;
  onActivate(): void;
}) {
  const { result, availability } = props;
  const Icon = result.kind === "project" ? Folder : result.kind === "session" ? Terminal : Command;
  return (
    // Options receive pointer input; the owning combobox supplies keyboard navigation.
    // biome-ignore lint/a11y/useKeyWithClickEvents: input-held listbox focus pattern.
    <div
      role="option"
      tabIndex={-1}
      id={props.id}
      aria-selected={props.selected}
      aria-disabled={!availability.enabled}
      onPointerMove={props.onSelect}
      // Prevent pointer selection from moving focus away from the query.
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onActivate}
      className={`flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm ${props.selected ? "bg-surface-soft" : ""}`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1 break-words">
        <div>
          <HighlightText text={result.title} ranges={result.titleHighlights} />
        </div>
        {result.context !== null && (
          <div className="text-xs text-muted">
            <HighlightText text={result.context} ranges={result.contextHighlights} />
          </div>
        )}
        {!availability.enabled && <div className="text-xs text-muted">{availability.reason}</div>}
      </div>
      {result.shortcut && props.platform && (
        <span className="shrink-0 text-xs text-muted">
          <kbd>{formatShortcut(result.shortcut, props.platform)}</kbd>
          {result.shortcut.isConflicted && <span className="block">Shortcut conflict</span>}
        </span>
      )}
    </div>
  );
}
