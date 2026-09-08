import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MarkdownContent } from "./markdown-content";
/** Keep every resource-bearing Markdown construct inert while preserving useful text. */
it("renders GFM without resources or active protocols", () => {
  const { container } = render(
    <MarkdownContent
      text={
        "# Title\n\n![alt](https://private/image)\n\n[go](javascript:alert(1))\n\n<script>bad()</script>\n\n- [x] Done\n\n| a | b |\n| - | - |\n| 1 | 2 |"
      }
    />,
  );
  expect(container.querySelector("img,a,script")).toBeNull();
  expect(screen.getByText("alt")).toBeVisible();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("table")).toBeVisible();
  expect(container.textContent).toContain("javascript:alert(1)");
});
