import { getVersion } from "@tauri-apps/api/app";
import { arch, platform, version } from "@tauri-apps/plugin-os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAppInfo } from "./app-info";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-os", () => ({ arch: vi.fn(), platform: vi.fn(), version: vi.fn() }));

const getVersionMock = vi.mocked(getVersion);
const archMock = vi.mocked(arch);
const platformMock = vi.mocked(platform);
const osVersionMock = vi.mocked(version);

describe("readAppInfo", () => {
  // Supply deterministic app and OS facts before each adapter test.
  beforeEach(() => {
    getVersionMock.mockReset().mockResolvedValue("0.0.0");
    platformMock.mockReset().mockReturnValue("windows");
    osVersionMock.mockReset().mockReturnValue("11");
    archMock.mockReset().mockReturnValue("x86_64");
  });

  // Verify all four sources are read once and combined without presentation mapping.
  it("returns one complete app-info object", async () => {
    await expect(readAppInfo()).resolves.toEqual({
      appVersion: "0.0.0",
      osPlatform: "windows",
      osVersion: "11",
      osArch: "x86_64",
    });
    expect(getVersionMock).toHaveBeenCalledOnce();
    expect(platformMock).toHaveBeenCalledOnce();
    expect(osVersionMock).toHaveBeenCalledOnce();
    expect(archMock).toHaveBeenCalledOnce();
  });

  // Verify platform identifiers remain untouched for the page to map later.
  it.each(["windows", "macos", "linux"] as const)(
    "preserves the %s platform identifier",
    async (value) => {
      platformMock.mockReturnValue(value);

      await expect(readAppInfo()).resolves.toMatchObject({ osPlatform: value });
    },
  );

  // Verify one denied OS permission rejects the operation instead of leaking partial facts.
  it("rejects the entire read when an OS source fails", async () => {
    const denial = new Error("permission denied");
    archMock.mockImplementation(() => {
      throw denial;
    });

    await expect(readAppInfo()).rejects.toBe(denial);
  });
});
