import type { ReactNode } from "react";

/** Render the shared heading and body rhythm of one Settings section. */
export function SettingsSection(props: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <h1 className="font-display text-[28px] leading-tight tracking-tight text-ink">
          {props.title}
        </h1>
        {props.action}
      </div>
      <p className="mt-1 text-[13px] text-muted">{props.description}</p>
      <div className="mt-6 min-w-0">{props.children}</div>
    </section>
  );
}

/**
 * Render one labelled Settings value with its explanation and control. The default `inline`
 * layout keeps the trailing control in its own column; `stacked` places a full-width control
 * under the label, which is what the Appearance colour editors need.
 */
export function SettingRow(props: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  first?: boolean;
  layout?: "inline" | "stacked";
}) {
  const stacked = props.layout === "stacked";

  return (
    <div
      className={`min-w-0 py-3.5 ${stacked ? "" : "grid grid-cols-[minmax(0,1fr)_340px] items-center gap-6"} ${props.first ? "" : "border-t border-hairline-soft"}`}
    >
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-body-strong">{props.label}</div>
        {props.description !== undefined && (
          <div className="mt-0.5 text-[12px] leading-5 text-muted">{props.description}</div>
        )}
      </div>
      <div
        className={
          stacked ? "mt-3 flex min-w-0 items-start" : "flex min-w-0 items-center justify-end"
        }
      >
        {props.children}
      </div>
    </div>
  );
}
