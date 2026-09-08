import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";

// Untrusted Markdown must never create a network resource or actionable navigation.
it("renders safe GFM and turns all URLs into inert text", () => {
  const view = render(
    <MarkdownPreview
      text={
        '# Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] Done\n\n![remote](https://example.com/a.png)\n[bad](javascript:alert) [local](file:///x) [data](data:text/plain,x)\n<iframe src="https://example.com"></iframe><img src="https://example.com">'
      }
      onEdit={vi.fn()}
    />,
  );
  expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(view.container.querySelector("img,iframe,a[href]")).toBeNull();
  expect(screen.getByText("remote")).toBeInTheDocument();
  expect(screen.getByText(/javascript:alert/)).toBeInTheDocument();
});
// Empty preview still offers the explicit path back to the editor.
it("explains empty content", () => {
  render(<MarkdownPreview text="" onEdit={vi.fn()} />);
  expect(screen.getByText(/This file is empty/)).toBeInTheDocument();
});

// Release mounted surfaces between isolated component cases.
afterEach(cleanup);
