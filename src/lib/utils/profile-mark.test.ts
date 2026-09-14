import { describe, expect, it } from "vitest";
import { profileMarkColor } from "./profile-mark";

// Built-in presentation must not override a user's custom profile color.
describe("profileMarkColor", () => {
  // Only stable built-in identities receive their wireframe marks.
  it("keeps custom colors and maps built-in identities", () => {
    expect(profileMarkColor({ id: "custom", color: "#123456" })).toBe("#123456");
    expect(profileMarkColor({ id: "builtin:codex", color: "#123456" })).toBe("#141413");
    expect(profileMarkColor({ id: "builtin:terminal", color: "#123456" })).toBe("#252320");
    expect(profileMarkColor({ id: "builtin:claude", color: "#123456" })).toBe("#cc785c");
  });
});
