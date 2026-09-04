import { useNavigate } from "react-router";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import { formatUsedAt, readRecentTools } from "./recent-tools-store";
import { isProfileUnavailable, SessionToolCard } from "./session-tool-card";
import type { ToolCatalogData } from "./use-tool-catalog";

/** Most recent tools shown before the complete catalog. */
const RECENT_LIMIT = 4;

/** Render the six stable loading placeholders of the tool column. */
function PickerSkeleton() {
  return (
    <div role="status" aria-label="Loading your CLI profiles" className="grid gap-2">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <span key={index} className="h-14 animate-pulse rounded-lg bg-surface-card" />
      ))}
    </div>
  );
}

/** Render tool choices for one empty pane using the workspace's shared catalog. */
export function PaneContentPicker(props: {
  catalog: ToolCatalogData;
  selectingProfileId: string | null;
  isLocked: boolean;
  onSelect(profile: CliProfileDto): void;
}) {
  const { catalog, selectingProfileId, isLocked, onSelect } = props;
  const navigate = useNavigate();
  const profiles = catalog.snapshot?.profiles ?? [];
  const now = Date.now();
  const recent = readRecentTools(RECENT_LIMIT).flatMap((entry) => {
    const profile = profiles.find((candidate) => candidate.id === entry.profileId);
    return profile === undefined
      ? []
      : [{ profile, usedAtLabel: formatUsedAt(entry.usedAtMs, now) }];
  });

  /** Open the existing terminal-profile settings route. */
  const openSettings = (): void => {
    void navigate("/settings/terminal-profiles");
  };

  /** Render one catalog or recent profile card. */
  const renderCard = (profile: CliProfileDto, usedAtLabel: string | null, key: string) => {
    const unavailable =
      isProfileUnavailable(profile) || catalog.unavailableProfileIds.has(profile.id);
    return (
      <SessionToolCard
        key={key}
        profile={profile}
        usedAtLabel={usedAtLabel}
        isUnavailable={unavailable}
        isChecking={catalog.checkingProfileIds.has(profile.id)}
        isSelecting={selectingProfileId === profile.id}
        isLocked={isLocked}
        onSelect={() => onSelect(profile)}
        onCheckAgain={() => void catalog.check(profile.id)}
        onOpenSettings={openSettings}
      />
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas px-8 py-7">
      <div className="mx-auto grid max-w-[980px] gap-6">
        <header>
          <h2 className="font-display text-[22px] text-ink">What goes here?</h2>
          <p className="text-[13px] text-muted">Pick a tool or a file for this pane.</p>
        </header>

        {recent.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-[11px] font-medium tracking-[1.2px] text-muted uppercase">
              Recent
            </h3>
            <div className="grid gap-2">
              {recent.map(({ profile, usedAtLabel }) =>
                renderCard(profile, usedAtLabel, `recent:${profile.id}`),
              )}
            </div>
          </section>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <section className="grid content-start gap-2">
            <h3 className="text-[11px] font-medium tracking-[1.2px] text-muted uppercase">
              Terminal / CLI
            </h3>
            {catalog.status === "error" && catalog.snapshot === null ? (
              <div className="grid justify-items-start gap-2">
                <p role="alert" className="text-[13px] text-error">
                  {catalog.failure?.message}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={catalog.refresh}>
                  Try again
                </Button>
              </div>
            ) : catalog.status === "loading" && catalog.snapshot === null ? (
              <PickerSkeleton />
            ) : (
              <div className="grid gap-2">
                {profiles.map((profile) => renderCard(profile, null, `all:${profile.id}`))}
              </div>
            )}
          </section>

          <section className="grid content-start gap-2">
            <h3 className="text-[11px] font-medium tracking-[1.2px] text-muted uppercase">File</h3>
            <div className="rounded-lg border border-dashed border-hairline px-4 py-5 text-[13px] text-muted-soft">
              Files arrive with FE-016.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
