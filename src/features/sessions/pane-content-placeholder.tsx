import type { PaneContentDto } from "@/bindings/sessions/sessions";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";

/** Render truthful deferred content for pane renderers owned by later features. */
export function PaneContentPlaceholder(props: {
  content: Exclude<PaneContentDto, { kind: "empty" }>;
  profiles: readonly CliProfileDto[];
}) {
  const { content, profiles } = props;
  if (content.kind === "toolSelection") {
    const profile = profiles.find((candidate) => candidate.id === content.profileId);
    return (
      <div className="grid h-full place-content-center gap-1 px-6 text-center text-on-dark">
        <p className="font-medium">{profile?.name ?? content.title} is ready to run.</p>
        <p className="text-xs text-muted-soft">Terminals arrive with FE-008.</p>
      </div>
    );
  }
  if (content.kind === "terminal") {
    return (
      <div className="grid h-full place-content-center text-center text-sm text-muted-soft">
        Terminals arrive with FE-008.
      </div>
    );
  }
  return (
    <div className="grid h-full place-content-center text-center text-sm text-muted-soft">
      File panes arrive with FE-017.
    </div>
  );
}
