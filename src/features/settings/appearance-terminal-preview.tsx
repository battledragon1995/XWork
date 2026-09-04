import type { TerminalPaletteDto } from "@/bindings/settings";

/** The prompt string repeated by the wireframe sample, kept verbatim. */
const PROMPT = "PS F:\\Self Projects\\XWork>";

/**
 * Render the static three-line terminal sample of the wireframe. FE-008 owns the real
 * terminal; this block only demonstrates the selected palette and size, so it never runs a
 * process and keeps its own overflow inside the fixed-height frame.
 */
export function AppearanceTerminalPreview(props: {
  palette: TerminalPaletteDto;
  fontSizePx: number;
}) {
  const { palette, fontSizePx } = props;
  const ansi = palette.ansiColors;

  return (
    // The block is a labelled static sample, not a form section, so the group role is the
    // closest accurate one and no semantic element fits it.
    // biome-ignore lint/a11y/useSemanticElements: a static sample is not a fieldset
    <div
      aria-label="Terminal preview"
      className="h-24 w-full min-w-0 overflow-x-auto overflow-y-hidden rounded-md border border-hairline"
      role="group"
      style={{ backgroundColor: palette.background }}
    >
      <pre
        className="m-0 px-3 py-2 font-mono leading-6 whitespace-pre"
        style={{ color: palette.foreground, fontSize: `${fontSizePx}px` }}
      >
        <span style={{ color: ansi[12] }}>{PROMPT}</span> pnpm test{"\n"}{" "}
        <span style={{ color: ansi[2] }}>✓</span> project-card.test.tsx{" "}
        <span style={{ color: ansi[8] }}>(6)</span>
        {"   "}
        <span style={{ color: ansi[3] }}>⚠</span> 1 skipped{"   "}
        <span style={{ color: ansi[1] }}>✗</span> 0 failed{"\n"}
        <span style={{ color: ansi[12] }}>{PROMPT}</span> <span>▮</span>
      </pre>
    </div>
  );
}
