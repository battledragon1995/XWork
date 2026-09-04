import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { SessionDetailDto } from "@/bindings/sessions/sessions";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import { selectSessionTool } from "@/lib/ipc/sessions";
import { classifySessionsFailure, type SessionsFailure } from "@/lib/utils/session-copy";
import { formatUsedAt, readRecentTools, recordToolUse } from "./recent-tools-store";
import { isProfileUnavailable, SessionToolCard } from "./session-tool-card";
import { useToolCatalog } from "./use-tool-catalog";

/** Route of the existing Settings page this picker only ever navigates to. */
const CLI_PROFILES_ROUTE = "/settings/terminal-profiles";

/** Hint that states the two ways to pick a tool and what picking one does. */
export const PICKER_HINT =
  "Press 1–9 to pick, Enter to start. The tool runs in a new tab at the project root.";

/** Copy for a tool the backend no longer knows about. */
export const TOOL_GONE_MESSAGE = "That tool no longer exists.";

/** Most recent tools the block ever shows. */
const RECENT_LIMIT = 4;

/** Highest number key the picker answers to. */
const MAX_NUMBER_KEY = 9;

/** Elements whose own keystrokes must never be stolen by a local number key. */
const TEXT_ENTRY_SELECTOR = "input, textarea, select, [contenteditable='true'], [role='textbox']";

/** What the route hands the picker. */
export interface SessionToolPickerProps {
  sessionId: string;
  /** Adopt the post-commit snapshot the selection answered with. */
  onSelected(detail: SessionDetailDto): void;
  /** Re-read the route's own session, for the two outcomes only it can resolve. */
  onRefresh(): void;
}

/** One rendered card, in the exact order the number keys follow. */
interface NumberedCard {
  key: string;
  profile: CliProfileDto;
  usedAtLabel: string | null;
}

/** Render the placeholder grid shown while the catalog has not answered yet. */
function CatalogSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading your CLI profiles"
      className="grid gap-3 @min-[900px]:grid-cols-3 @min-[640px]:grid-cols-2"
    >
      {/* Six placeholders: the three built-ins plus room for the custom profiles most
          installations have, so the grid does not jump when the real cards arrive. */}
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <span key={index} className="h-14 animate-pulse rounded-lg bg-surface-card" />
      ))}
    </div>
  );
}

/**
 * The `New Session` tool picker, shown while a session has no tab yet.
 *
 * Picking a tool creates BE-005 `toolSelection` content and nothing else: no process is
 * started at this slice, and no tab or pane command other than `select_session_tool` is ever
 * called from here.
 */
export function SessionToolPicker(props: SessionToolPickerProps) {
  const { sessionId, onSelected, onRefresh } = props;
  const catalog = useToolCatalog();
  const navigate = useNavigate();

  /** Profile whose selection is running, which locks every card while it is set. */
  const [selectingProfileId, setSelectingProfileId] = useState<string | null>(null);
  const selectingRef = useRef<string | null>(null);
  const [failure, setFailure] = useState<SessionsFailure | null>(null);
  /** True once the backend said the session is closing, which locks the picker for good. */
  const [isClosing, setClosing] = useState(false);

  /** Root of the picker, used to decide whether it currently owns the focus context. */
  const rootRef = useRef<HTMLDivElement>(null);
  /** Rendered cards by key, so a number key can focus the exact element it points at. */
  const cardRefs = useRef(new Map<string, HTMLElement | null>());

  const openCliProfiles = useCallback(() => {
    void navigate(CLI_PROFILES_ROUTE);
  }, [navigate]);

  const profiles = catalog.snapshot?.profiles ?? [];

  /** Report whether one profile cannot be launched, snapshot or refused selection alike. */
  const isUnavailable = useCallback(
    (profile: CliProfileDto): boolean =>
      isProfileUnavailable(profile) || catalog.unavailableProfileIds.has(profile.id),
    [catalog.unavailableProfileIds],
  );

  const now = Date.now();
  /**
   * Recent cards, in the memory order of this run. A profile deleted from Settings simply
   * disappears from the block, because only the snapshot decides what exists.
   */
  const recentCards: NumberedCard[] = readRecentTools(RECENT_LIMIT).flatMap((entry) => {
    const profile = profiles.find((candidate) => candidate.id === entry.profileId);
    return profile === undefined
      ? []
      : [
          {
            key: `recent:${profile.id}`,
            profile,
            usedAtLabel: formatUsedAt(entry.usedAtMs, now),
          },
        ];
  });

  /**
   * Every card in one flat list, recent block first. The `Add a CLI profile` card is not part
   * of it, so it never consumes a number key.
   */
  const numberedCards: NumberedCard[] = [
    ...recentCards,
    ...profiles.map((profile) => ({
      key: `all:${profile.id}`,
      profile,
      usedAtLabel: null,
    })),
  ];

  /** Select one tool, once, and let the backend decide what happens next. */
  const select = useCallback(
    async (profile: CliProfileDto) => {
      if (selectingRef.current !== null || isClosing || isUnavailable(profile)) {
        // The single guard against two cards being pressed almost at the same time.
        return;
      }

      selectingRef.current = profile.id;
      setSelectingProfileId(profile.id);
      setFailure(null);

      try {
        const detail = await selectSessionTool(sessionId, profile.id);
        recordToolUse(profile.id, Date.now());
        onSelected(detail);
      } catch (rejection: unknown) {
        const classified = classifySessionsFailure(rejection);

        switch (classified.code) {
          case "profileNotFound":
            // The card the user pressed is stale, so the committed catalog replaces it.
            catalog.refresh();
            setFailure({ ...classified, message: TOOL_GONE_MESSAGE });
            break;
          case "profileUnavailable":
            // Mark the card at once so the reason is on screen immediately, then let a real
            // check bring the snapshot up to date behind it.
            catalog.markUnavailable(profile.id);
            void catalog.check(profile.id);
            break;
          case "sessionNotEmpty":
          case "sessionNotFound":
            // Only the route can resolve these: one switches branch, the other leaves.
            onRefresh();
            break;
          case "closeInProgress":
            setClosing(true);
            setFailure(classified);
            break;
          default:
            setFailure(classified);
            break;
        }
      } finally {
        selectingRef.current = null;
        setSelectingProfileId(null);
      }
    },
    [catalog, isClosing, isUnavailable, onRefresh, onSelected, sessionId],
  );

  // Mirror the values the key handler needs, so it is registered once and never re-bound.
  const handlerStateRef = useRef({ numberedCards, select, isUnavailable, isClosing });
  handlerStateRef.current = { numberedCards, select, isUnavailable, isClosing };

  useEffect(() => {
    /** Answer a local number key, but only while this picker owns the focus context. */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.isComposing || event.repeat) {
        return;
      }

      const digit = Number(event.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > MAX_NUMBER_KEY) {
        return;
      }

      const target = event.target;
      if (target instanceof Element && target.closest(TEXT_ENTRY_SELECTOR) !== null) {
        // A typed digit belongs to the field the user is typing in, never to this picker.
        return;
      }

      const root = rootRef.current;
      const active = document.activeElement;
      const ownsFocus =
        root !== null && (active === null || active === document.body || root.contains(active));
      if (!ownsFocus) {
        // A dialog traps focus while it is open, so the picker deliberately stays silent.
        return;
      }

      const state = handlerStateRef.current;
      if (state.isClosing || selectingRef.current !== null) {
        return;
      }

      const card = state.numberedCards[digit - 1];
      if (card === undefined) {
        // A number beyond the visible cards is ignored rather than clamped to the last one.
        return;
      }

      event.preventDefault();

      if (state.isUnavailable(card.profile)) {
        // An unavailable card is never selected by a key press; the key only puts the user in
        // front of the reason and the two controls that can resolve it.
        cardRefs.current.get(card.key)?.focus();
        return;
      }

      void state.select(card.profile);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  /** Render one card with everything its own state depends on. */
  const renderCard = (card: NumberedCard) => (
    <SessionToolCard
      key={card.key}
      profile={card.profile}
      usedAtLabel={card.usedAtLabel}
      isUnavailable={isUnavailable(card.profile)}
      isChecking={catalog.checkingProfileIds.has(card.profile.id)}
      isSelecting={selectingProfileId === card.profile.id}
      isLocked={selectingProfileId !== null || isClosing}
      cardRef={(element) => {
        cardRefs.current.set(card.key, element);
      }}
      onSelect={() => void select(card.profile)}
      onCheckAgain={() => void catalog.check(card.profile.id)}
      onOpenSettings={openCliProfiles}
    />
  );

  if (catalog.status === "error") {
    return (
      <div ref={rootRef} className="grid justify-items-start gap-3">
        <p role="alert" className="text-[15px] text-body">
          {catalog.failure?.message}
        </p>
        <Button type="button" variant="outline" onClick={catalog.refresh}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="grid min-w-0 gap-6">
      {recentCards.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-[11px] font-medium tracking-[1.2px] text-muted-soft uppercase">
            Recently used
          </h2>
          <div className="grid max-w-[760px] gap-3 @min-[640px]:grid-cols-2">
            {recentCards.map(renderCard)}
          </div>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="text-[11px] font-medium tracking-[1.2px] text-muted-soft uppercase">
          All tools
        </h2>

        {failure !== null && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-error">
            {failure.message}
            {failure.canRetry && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-brand underline underline-offset-4"
                onClick={catalog.refresh}
              >
                Try again
              </Button>
            )}
          </p>
        )}

        {catalog.status === "loading" && catalog.snapshot === null ? (
          <CatalogSkeleton />
        ) : (
          <div className="grid gap-3 @min-[900px]:grid-cols-3 @min-[640px]:grid-cols-2">
            {/* The backend order is preserved exactly: Codex, Claude, Terminal, then the
                custom profiles. Only the separate recent block is promoted. */}
            {profiles.map((profile) =>
              renderCard({ key: `all:${profile.id}`, profile, usedAtLabel: null }),
            )}
            <button
              type="button"
              className="flex min-w-0 items-center gap-3 rounded-lg border border-dashed border-hairline px-3 py-2.5 text-left text-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={openCliProfiles}
            >
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">Add a CLI profile</span>
                <span className="block truncate text-xs text-muted-soft">
                  Settings › Terminal &amp; CLI Profiles
                </span>
              </span>
            </button>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-soft">{PICKER_HINT}</p>
    </div>
  );
}
