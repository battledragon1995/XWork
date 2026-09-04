import { LayoutPanelLeft } from "lucide-react";

/**
 * Content branch of a session that already has at least one tab.
 *
 * FE-006 deliberately renders nothing but this notice: the tab strip and the pane tree are
 * FE-007's, and guessing at their shape here would have to be undone. The tab count comes
 * from the session snapshot so the user can still see that their choice took effect.
 */
export function SessionWorkspacePlaceholder(props: { tabCount: number }) {
  const { tabCount } = props;

  return (
    <section className="grid justify-items-start gap-2 rounded-lg border border-dashed border-hairline px-5 py-6">
      <LayoutPanelLeft aria-hidden="true" className="size-5 text-muted-soft" />
      <p className="text-[15px] text-body-strong">
        This session has {tabCount} {tabCount === 1 ? "tab" : "tabs"}.
      </p>
      <p className="text-[13px] text-muted">Tabs and panes arrive with FE-007.</p>
    </section>
  );
}
