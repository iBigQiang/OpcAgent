import { afterEach, describe, expect, it, mock } from "bun:test";
import { getLatestVersion, getManifest } from "./manifest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GitHub release manifest", () => {
  it("reads the latest v-prefixed release", async () => {
    globalThis.fetch = mock(async (input) => {
      expect(String(input)).toBe(
        "https://api.github.com/repos/iBigQiang/OpcAgent/releases/latest",
      );
      return Response.json({ tag_name: "v0.1.0" });
    }) as unknown as typeof fetch;

    expect(await getLatestVersion()).toBe("0.1.0");
  });

  it("downloads the manifest from the matching release tag", async () => {
    globalThis.fetch = mock(async (input) => {
      expect(String(input)).toBe(
        "https://github.com/iBigQiang/OpcAgent/releases/download/v0.1.0/manifest.json",
      );
      return Response.json({
        version: "0.1.0",
        build_time: "2026-08-13T00:00:00.000Z",
        build_timestamp: 0,
        binaries: {},
      });
    }) as unknown as typeof fetch;

    expect((await getManifest("0.1.0"))?.version).toBe("0.1.0");
  });
});
