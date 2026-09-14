import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useCliProfilesStore } from "./cli-profiles-store";
import { SettingsSection } from "./settings-section";
import { useAppInfo } from "./use-app-info";

/** Convert Tauri platform identifiers into the product labels specified for About. */
function platformLabel(platform: string): string {
  if (platform === "windows") {
    return "Windows";
  }
  if (platform === "macos") {
    return "macOS";
  }
  return platform;
}

/** Render stable XWork branding while application and OS details load independently. */
export function SettingsAboutRoute() {
  const { status, info, reload } = useAppInfo();
  const profiles = useCliProfilesStore();
  useEffect(() => {
    // Reuse the retained catalog and its invalidation listener for the real default shell.
    const { acquire, release } = useCliProfilesStore.getState();
    acquire();
    return release;
  }, []);
  const shell = profiles.snapshot?.shells.find(
    // Resolve System default to the concrete shell reported by the backend.
    (entry) => entry.id === profiles.snapshot?.effectiveDefaultShellId,
  );

  return (
    <SettingsSection title="About" description="Application and operating-system details.">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <h2
          className="font-display text-[40px] leading-none tracking-tight text-ink"
          aria-label="XWork"
        >
          <span className="text-brand">X</span>Work
        </h2>
        <div>
          {status === "ready" && info !== null && (
            <p className="font-mono text-[12px] text-body-strong">Version {info.appVersion}</p>
          )}
          <p className="mt-1 text-[13px] text-muted">
            Local-first workspace for projects and AI CLIs
          </p>
        </div>
      </div>

      {status === "loading" && (
        <p aria-busy="true" className="mt-6 text-[13px] text-muted">
          Loading application details…
        </p>
      )}

      {status === "error" && (
        <div role="alert" className="mt-6 flex flex-col items-start gap-3">
          <p className="text-[13px] text-error">XWork couldn't read its application details.</p>
          <Button type="button" variant="outline" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {status === "ready" && info !== null && (
        <div className="mt-6 min-w-0">
          <div data-testid="app-info-table-scroll" className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-[13px]">
              <tbody>
                <tr className="border-b border-hairline-soft">
                  <th scope="row" className="w-[42%] py-3 font-medium text-muted">
                    Operating system
                  </th>
                  <td className="py-3 font-mono text-[12px] text-body">
                    {platformLabel(info.osPlatform)} {info.osVersion}
                  </td>
                </tr>
                <tr className="border-b border-hairline-soft">
                  <th scope="row" className="py-3 font-medium text-muted">
                    Architecture
                  </th>
                  <td className="py-3 font-mono text-[12px] text-body">{info.osArch}</td>
                </tr>
                <tr className="border-b border-hairline-soft">
                  <th scope="row" className="py-3 font-medium text-muted">
                    Default shell
                  </th>
                  <td className="py-3 text-[12px] text-body">
                    {profiles.status === "error" ? (
                      <span className="flex items-center gap-2">
                        <span>Could not read default shell.</span>
                        <Button size="sm" variant="ghost" onClick={profiles.refresh}>
                          Retry shell
                        </Button>
                      </span>
                    ) : shell ? (
                      `${shell.displayName} (${shell.command})`
                    ) : profiles.snapshot === null ? (
                      "Loading…"
                    ) : (
                      "No available shell"
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
