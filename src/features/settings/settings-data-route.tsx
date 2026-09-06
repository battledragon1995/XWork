import { useCallback, useEffect, useRef, useState } from "react";
import type { DataLocationDto } from "@/bindings/data-management";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyDataLocation, getDataLocation, openDataLocation } from "@/lib/ipc/data-management";
import { useDataManagement } from "./data-management-provider";
import { SettingRow, SettingsSection } from "./settings-section";

/** Render Phase 1 Data actions while keeping location independent of settings loading. */
export function SettingsDataRoute() {
  const data = useDataManagement();
  const [location, setLocation] = useState<DataLocationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const token = useRef(0);
  /** Read only the backend-resolved location and retire obsolete responses. */
  const load = useCallback(async () => {
    const generation = ++token.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getDataLocation();
      if (token.current === generation) setLocation(next);
    } catch {
      if (token.current === generation) setError("Could not read the data location.");
    } finally {
      if (token.current === generation) setLoading(false);
    }
  }, []);
  useEffect(
    /** Location has route lifetime; operation preview is retired when the route leaves. */ () => {
      void load();
      return () => {
        token.current += 1;
        void data.retirePreview();
      };
    },
    [data.retirePreview, load],
  );
  /** Copy or open through narrow native commands, never through a caller-provided path. */
  async function locationAction(copy: boolean) {
    const generation = token.current;
    setError(null);
    setCopied(false);
    try {
      await (copy ? copyDataLocation() : openDataLocation());
      if (copy && token.current === generation) setCopied(true);
    } catch {
      if (token.current === generation)
        setError(copy ? "Could not copy the path." : "Could not open the data folder.");
    }
  }
  const disabled = data.busy || data.phase !== "idle" || data.listenerStatus === "registering";
  return (
    <SettingsSection
      title="Data"
      description="Everything XWork stores lives on this machine. Project source is never copied."
    >
      <SettingRow
        first
        label="Export a backup"
        description="Project metadata, custom CLI profiles, theme, shortcuts and settings. Secrets are included as references only. This unencrypted backup may contain private paths and configuration."
      >
        <Button
          variant="outline"
          disabled={disabled}
          onClick={/** Open the native export picker. */ () => void data.prepare("export")}
        >
          Export backup…
        </Button>
      </SettingRow>
      <SettingRow
        label="Import a backup"
        description="Project and profile records are merged. Included settings, default shell and shortcut overrides replace their current configuration."
      >
        <Button
          variant="outline"
          disabled={disabled}
          onClick={
            /** Prepare a preview without importing yet. */ () => void data.prepare("import")
          }
        >
          Import backup…
        </Button>
      </SettingRow>
      <p className="py-3 text-xs text-muted">
        Backups never include project source, running sessions, terminal output, CLI history, logs
        or notifications.
      </p>
      <SettingRow
        label="Data location"
        layout="stacked"
        description={
          location ? `${location.databaseFileName} · ${location.logsDirectoryName}` : undefined
        }
      >
        <div className="min-w-0 w-full space-y-2" aria-busy={loading}>
          {loading && <p role="status">Loading data location…</p>}
          {location && (
            <Input
              aria-label="Data location"
              readOnly
              value={location.directory}
              className="w-full"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!location || loading}
              onClick={/** Copy the native location. */ () => void locationAction(true)}
            >
              Copy path
            </Button>
            <Button
              variant="outline"
              disabled={!location || loading}
              onClick={/** Open the native location. */ () => void locationAction(false)}
            >
              Open folder
            </Button>
            {error && (
              <Button variant="outline" onClick={load}>
                Try again
              </Button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          {copied && <p role="status">Path copied.</p>}
        </div>
      </SettingRow>
      <h2 className="mt-8 text-lg font-medium text-error">Danger zone</h2>
      <SettingRow
        label="Reset XWork"
        description="Removes project metadata, custom profiles and notifications, and restores settings and shortcuts to defaults. Running sessions are stopped. Project files and logs are kept."
      >
        <Button
          variant="destructive"
          disabled={disabled}
          onClick={
            /** Read impact before requesting the RESET literal. */ () => void data.prepare("reset")
          }
        >
          Reset XWork…
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}
