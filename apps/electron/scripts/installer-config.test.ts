import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

describe("Windows installer configuration", () => {
  it("uses an assisted installer with a selectable destination", () => {
    const config = yaml.load(
      readFileSync(resolve(import.meta.dir, "../electron-builder.yml"), "utf8"),
    ) as {
      productName?: string;
      files?: string[];
      nsis?: {
        oneClick?: boolean;
        allowToChangeInstallationDirectory?: boolean;
      };
    };

    expect(config.productName).toBe("OPC Agent");
    expect(config.nsis?.oneClick).toBe(false);
    expect(config.nsis?.allowToChangeInstallationDirectory).toBe(true);
    expect(config.files).toContain("!node_modules/@opcagent{,/**/*}");
    expect(config.files).toContain("!node_modules/@anthropic-ai/claude-agent-sdk{,/**/*}");
    expect(config.files).toContain("!node_modules/@anthropic-ai/claude-agent-sdk-*{,/**/*}");
  });
});
