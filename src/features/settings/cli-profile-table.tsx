import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import type {
  CliProfileAvailabilityDto,
  CliProfileAvailabilityStatusDto,
  CliProfileDto,
} from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Textual label of every generated availability status, so colour is never the only signal. */
const AVAILABILITY_LABELS: Record<CliProfileAvailabilityStatusDto, string> = {
  unchecked: "Not checked",
  available: "Available",
  commandNotFound: "Command not found",
  shellNotFound: "Shell not found",
};

/** Tone class of every availability status, used together with its label and never alone. */
const AVAILABILITY_TONES: Record<CliProfileAvailabilityStatusDto, string> = {
  unchecked: "border-hairline text-muted",
  available: "border-hairline text-body-strong",
  commandNotFound: "border-warn-ink/40 text-warn-ink",
  shellNotFound: "border-warn-ink/40 text-warn-ink",
};

/**
 * Format the completion time of one check in machine-local time. A value the runtime cannot
 * turn into a date is dropped rather than rendered as an obviously wrong time.
 */
export function formatCheckedAt(checkedAtUnixMs: string | null): string | null {
  if (checkedAtUnixMs === null || !/^\d+$/.test(checkedAtUnixMs)) {
    return null;
  }

  const date = new Date(Number(checkedAtUnixMs));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `Checked ${date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

/**
 * Build the readable command line of one custom profile. The result exists only to be read:
 * the quoting below is display sugar and is never parsed back into a command or arguments.
 */
export function formatCommandForDisplay(command: string | null, args: readonly string[]): string {
  if (command === null) {
    return "—";
  }

  const parts = args.map((argument) =>
    argument === "" || /[\s"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument,
  );
  return [command, ...parts].join(" ");
}

/** Render the coloured identity mark of one profile next to its own textual name. */
function ProfileMark(props: { icon: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-hairline text-[11px] font-semibold text-on-dark"
      style={{ backgroundColor: props.color }}
    >
      {props.icon}
    </span>
  );
}

/** Render the availability of one profile as text, plus the time it was measured. */
function AvailabilityBadge(props: {
  availability: CliProfileAvailabilityDto;
  isChecking: boolean;
}) {
  const { availability, isChecking } = props;
  const checkedAt = isChecking ? null : formatCheckedAt(availability.checkedAtUnixMs);

  return (
    <span className="flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap ${
          isChecking ? "border-hairline text-muted" : AVAILABILITY_TONES[availability.status]
        }`}
      >
        {isChecking ? "Checking…" : AVAILABILITY_LABELS[availability.status]}
      </span>
      {checkedAt !== null && <span className="text-[11px] text-muted">{checkedAt}</span>}
    </span>
  );
}

/** Render one icon-only row action with both a tooltip and a textual accessible name. */
function RowAction(props: {
  label: string;
  tooltip: string;
  disabled: boolean;
  destructive?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={props.label}
          disabled={props.disabled}
          onClick={props.onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
          className={props.destructive === true ? "text-error" : undefined}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** What the page hands one profile group. Built-ins simply omit the two custom callbacks. */
export interface CliProfileTableProps {
  label: string;
  profiles: readonly CliProfileDto[];
  showArguments: boolean;
  checkingProfileIds: ReadonlySet<string>;
  actionsDisabled: boolean;
  onCheck(profileId: string): void;
  onEdit?(profile: CliProfileDto): void;
  onDelete?(profile: CliProfileDto): void;
}

/**
 * Render one group of profiles. Edit and Delete are rendered only for a custom profile whose
 * callback the page supplied, which is what keeps the three built-ins read-only by shape
 * rather than by a runtime guard that could be forgotten.
 */
export function CliProfileTable(props: CliProfileTableProps) {
  const { label, profiles, showArguments, checkingProfileIds, actionsDisabled } = props;

  return (
    <div className="overflow-x-auto rounded-md border border-hairline">
      <table aria-label={label} className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-hairline text-left text-[11px] tracking-[0.08em] text-muted uppercase">
            <th className="px-3 py-2 font-medium" scope="col">
              Profile
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Command
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Status
            </th>
            <th className="px-3 py-2" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => {
            const isChecking = checkingProfileIds.has(profile.id);
            const canEdit = profile.kind === "custom" && props.onEdit !== undefined;
            const canDelete = profile.kind === "custom" && props.onDelete !== undefined;

            return (
              <tr className="border-t border-hairline-soft" key={profile.id}>
                <td className="px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <ProfileMark color={profile.color} icon={profile.icon} />
                    <span className="truncate font-medium text-ink">{profile.name}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[12px] text-body">
                  {showArguments
                    ? formatCommandForDisplay(profile.command, profile.arguments)
                    : (profile.command ?? "—")}
                </td>
                <td className="px-3 py-2">
                  <AvailabilityBadge availability={profile.availability} isChecking={isChecking} />
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center justify-end gap-0.5">
                    <RowAction
                      disabled={actionsDisabled || isChecking}
                      label={`Check command for ${profile.name}`}
                      onClick={() => props.onCheck(profile.id)}
                      tooltip="Check command"
                    >
                      <RefreshCw />
                    </RowAction>
                    {canEdit && (
                      <RowAction
                        disabled={actionsDisabled}
                        label={`Edit ${profile.name}`}
                        onClick={() => props.onEdit?.(profile)}
                        tooltip="Edit"
                      >
                        <Pencil />
                      </RowAction>
                    )}
                    {canDelete && (
                      <RowAction
                        destructive
                        disabled={actionsDisabled}
                        label={`Delete ${profile.name}`}
                        onClick={() => props.onDelete?.(profile)}
                        tooltip="Delete profile"
                      >
                        <Trash2 />
                      </RowAction>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
