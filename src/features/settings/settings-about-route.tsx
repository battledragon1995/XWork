import { Button } from "@/components/ui/button";
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

  return (
    <SettingsSection title="About" description="Application and operating-system details.">
      <div className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-dark font-display text-[26px] text-on-dark"
        >
          X
        </div>
        <div>
          <div className="font-display text-[28px] leading-none text-ink">XWork</div>
          <p className="mt-2 text-[13px] text-muted">
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
        <div className="mt-5 min-w-0 max-w-[560px]">
          <p className="font-mono text-[12px] text-muted">Version {info.appVersion}</p>
          <div data-testid="app-info-table-scroll" className="mt-5 max-w-full overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-[13px]">
              <tbody>
                <tr className="border-b border-hairline-soft">
                  <th scope="row" className="px-2.5 py-2 font-medium text-body-strong">
                    Operating system
                  </th>
                  <td className="px-2.5 py-2 text-body">
                    {platformLabel(info.osPlatform)} {info.osVersion}
                  </td>
                </tr>
                <tr className="border-b border-hairline-soft">
                  <th scope="row" className="px-2.5 py-2 font-medium text-body-strong">
                    Architecture
                  </th>
                  <td className="px-2.5 py-2 text-body">{info.osArch}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
