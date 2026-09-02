import { $, expect } from "@wdio/globals";

// Groups assertions for the shell rendered by the real desktop runtime.
describe("XWork desktop shell", () => {
  // Verifies that the application exposes its visible main landmark and heading.
  it("renders the accessible application shell", async () => {
    const main = await $("main[aria-label='XWork']");
    const heading = await $("h1=XWork");

    await expect(main).toBeDisplayed();
    await expect(heading).toBeDisplayed();
  });
});
