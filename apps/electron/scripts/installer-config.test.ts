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
        deleteAppDataOnUninstall?: boolean;
        include?: string;
      };
      win?: {
        files?: string[];
      };
    };

    expect(config.productName).toBe("OPC Agent");
    expect(config.nsis?.oneClick).toBe(false);
    expect(config.nsis?.allowToChangeInstallationDirectory).toBe(true);
    expect(config.nsis?.deleteAppDataOnUninstall).toBe(false);
    expect(config.nsis?.include).toBe("installer.nsh");
    expect(config.files).toContain("!release{,/**/*}");
    expect(config.win?.files).toContain("!release{,/**/*}");
    expect(config.files).toContain("!node_modules/@opcagent{,/**/*}");
    expect(config.files).toContain("!node_modules/@anthropic-ai/claude-agent-sdk{,/**/*}");
    expect(config.files).toContain("!node_modules/@anthropic-ai/claude-agent-sdk-*{,/**/*}");
  });

  it("keeps user data by default and only deletes the fixed profile directory on explicit request", () => {
    const installer = readFileSync(
      resolve(import.meta.dir, "../resources/installer.nsh"),
      "utf8",
    );

    expect(installer).toContain("!macro customUnWelcomePage");
    expect(installer).toContain("UninstPage custom un.OpcAgentDataPageCreate un.OpcAgentDataPageLeave");
    expect(installer).toContain('StrCpy $OpcAgentDeleteData "0"');
    expect(installer).toContain('GetOptions} $0 "--delete-opcagent-data"');
    expect(installer).toContain('GetOptions} $0 "--updated"');
    expect(installer).toContain('${If} $OpcAgentIsUpdated == "0"');
    expect(installer).toContain('ReadEnvStr $0 "USERPROFILE"');
    expect(installer).toContain('StrCpy $1 "$0\\.opcagent"');
    expect(installer).toContain('RMDir /r "$1"');
    expect(installer).not.toContain("$INSTDIR\\.opcagent");
    expect(installer).not.toContain("$APPDATA\\.opcagent");
  });
});
