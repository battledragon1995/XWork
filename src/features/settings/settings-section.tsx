import type { ReactNode } from "react";

/** Render the shared heading and body rhythm of one Settings section. */
export function SettingsSection(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h1 className="font-display text-[28px] leading-tight tracking-tight text-ink">
        {props.title}
      </h1>
      <p className="mt-1 text-[13px] text-muted">{props.description}</p>
      <div className="mt-6 min-w-0">{props.children}</div>
    </section>
  );
}

/** Render one labelled Settings value with its explanation and trailing control. */
export function SettingRow(props: {
  label: string;
  description: ReactNode;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_340px] items-center gap-6 py-3.5 ${props.first ? "" : "border-t border-hairline-soft"}`}
    >
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-body-strong">{props.label}</div>
        <div className="mt-0.5 text-[12px] leading-5 text-muted">{props.description}</div>
      </div>
      <div className="flex min-w-0 items-center justify-end">{props.children}</div>
    </div>
  );
}
