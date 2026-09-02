// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { createAppRouter } from "./app-router";

// Remove rendered output between tests so each router instance stays isolated.
afterEach(() => {
  cleanup();
});

describe("createAppRouter", () => {
  // Verify the root route renders the minimal shell named "XWork".
  it("renders the application shell at the root route", () => {
    const router = createAppRouter(["/"]);

    render(<RouterProvider router={router} />);

    expect(screen.getByRole("main", { name: "XWork" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "XWork" })).toBeInTheDocument();
  });
});
