import { RefreshCw } from "lucide-react";
import type { Ref } from "react";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/** The exact BE-006 identifier whose shell may be the application default. */
const BUILT_IN_TERMINAL_ID = "builtin:terminal";

/** Copy shown when a shell profile has no resolvable command at all. */
export const SHELL_NOT_RESOLVED_MESSAGE = "Shell not resolved";

/** Copy shown when the backend could not find the profile's own shell. */
export const SHELL_NOT_FOUND_MESSAGE = "Shell not found";

/** What one tool card renders and what it can ask the picker to do. */
export interface SessionToolCardProps {
  profile: CliProfileDto;
  /** `Used …` label of a recent card, or `null` for a card in the full catalog. */
  usedAtLabel: string | null;
  isUnavailable: boolean;
  isChecking: boolean;
  /** True while this card's own selection is crossing the boundary. */
  isSelecting: boolean;
  /** True while any selection is running, which locks every card at once. */
  isLocked: boolean;
  cardRef?: Ref<HTMLElement>;
  onSelect(): void;
  onCheckAgain(): void;
  onOpenSettings(): void;
}

/**
 * Decide whether one profile can be launched at all, from the snapshot alone.
 *
 * A profile with no resolvable command is unavailable whatever its recorded availability
 * says, because there is nothing for the backend to start.
 */
export function isProfileUnavailable(profile: CliProfileDto): boolean {
  return (
    profile.command === null ||
    profile.availability.status === "commandNotFound" ||
    profile.availability.status === "shellNotFound"
  );
}

/**
 * Build the card's secondary line.
 *
 * An unavailable profile states the reason instead of the command it would have run, because
 * the reason is the only thing the user can act on.
 */
export function describeToolCommand(profile: CliProfileDto): {
  text: string;
  isReason: boolean;
} {
  if (profile.availability.status === "commandNotFound") {
    return { text: `Command not found: ${profile.command ?? ""}`, isReason: true };
  }
  if (profile.availability.status === "shellNotFound") {
    return { text: SHELL_NOT_FOUND_MESSAGE, isReason: true };
  }
  if (profile.command === null) {
    return { text: SHELL_NOT_RESOLVED_MESSAGE, isReason: true };
  }

  if (profile.id === BUILT_IN_TERMINAL_ID && profile.shellId === null) {
    // The command already is the resolved default shell, so the suffix only names where that
    // choice came from — Settings, not this profile.
    return { text: `${profile.command} · default shell`, isReason: false };
  }

  return {
    text:
      profile.arguments.length === 0
        ? profile.command
        : `${profile.command} ${profile.arguments.join(" ")}`,
    isReason: false,
  };
}

/** Render the square profile mark, greyed out while the profile cannot be launched. */
function ProfileMark(props: { profile: CliProfileDto; isOff: boolean }) {
  const { profile, isOff } = props;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-on-primary",
        isOff && "bg-cream-strong text-muted-soft",
      )}
      style={isOff ? undefined : { backgroundColor: profile.color }}
    >
      {profile.icon}
    </span>
  );
}

/**
 * One tool card of the session picker.
 *
 * The available and the unavailable card are deliberately different elements: an available
 * card is one button the whole surface of which selects the tool, while an unavailable card
 * carries two controls of its own and therefore cannot be a button. It stays programmatically
 * focusable so a number key can still put the user in front of the reason it is unavailable.
 */
export function SessionToolCard(props: SessionToolCardProps) {
  const { profile, isUnavailable, isChecking, isSelecting, isLocked } = props;
  const command = describeToolCommand(profile);

  if (isUnavailable) {
    return (
      // A `fieldset` is the element that carries the `group` role natively, which is what
      // this card is: not an action of its own, but a container for the two controls that can
      // resolve its state. `tabIndex={-1}` keeps it out of the Tab order those controls belong
      // in, while still allowing a number key to focus it.
      <fieldset
        disabled={isLocked}
        tabIndex={-1}
        aria-label={`${profile.name}, unavailable`}
        ref={props.cardRef as Ref<HTMLFieldSetElement>}
        className="flex min-w-0 items-start gap-3 rounded-lg border border-hairline bg-surface-soft px-3 py-2.5 opacity-80 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ProfileMark profile={profile} isOff />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-body-strong">
            {profile.name}
          </span>
          <span className="block truncate font-mono text-xs text-error" title={command.text}>
            {command.text}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="rounded-sm bg-warn-surface px-1.5 py-0.5 text-[11px] font-medium text-warn-ink">
            {isChecking ? "Checking…" : "Unavailable"}
          </span>
          <span className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isChecking}
              onClick={props.onCheckAgain}
            >
              <RefreshCw aria-hidden="true" />
              Check again
            </Button>
            <button
              type="button"
              className="rounded-xs text-xs font-medium text-brand underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={props.onOpenSettings}
            >
              Open CLI Profiles
            </button>
          </span>
        </span>
      </fieldset>
    );
  }

  return (
    <button
      type="button"
      ref={props.cardRef as Ref<HTMLButtonElement>}
      disabled={isLocked}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-hairline bg-canvas px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      onClick={props.onSelect}
    >
      <ProfileMark profile={profile} isOff={false} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-body-strong">
          {profile.name}
        </span>
        <span className="block truncate font-mono text-xs text-muted" title={command.text}>
          {command.text}
        </span>
      </span>
      {/* One right-hand slot, so a running selection replaces the recency label instead of
          pushing the card's layout around. */}
      {isSelecting ? (
        <span className="shrink-0 text-xs text-muted-soft">Starting…</span>
      ) : props.usedAtLabel !== null ? (
        <span className="shrink-0 text-xs text-muted-soft">Used {props.usedAtLabel}</span>
      ) : null}
    </button>
  );
}
