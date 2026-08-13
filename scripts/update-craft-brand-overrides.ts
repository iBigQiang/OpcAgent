#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const manifestPath = resolve(import.meta.dir, "craft-source-overrides.json");
const selfPath = "scripts/craft-source-overrides.json";
const reason = "Reviewed OPC Agent brand, namespace, packaging, and release migration.";

type Entry = { sha256: string; reason: string };
type Manifest = {
  version: number;
  baselineCommit: string;
  modified: Record<string, Entry>;
  mkOnly: Record<string, Entry>;
  renamed?: Record<string, { to: string; reason: string }>;
};
type RestoredManifest = { productBaseline: string };

const renames: Record<string, string> = {
  "apps/electron/resources/tool-icons/mkagent.svg": "apps/electron/resources/tool-icons/opcagent.svg",
  "apps/electron/src/renderer/assets/mkagent_app_icon.png": "apps/electron/src/renderer/assets/opcagent_app_icon.png",
  "apps/electron/src/renderer/assets/mkagent_app_icon.svg": "apps/electron/src/renderer/assets/opcagent_app_icon.svg",
  "apps/electron/src/renderer/assets/mkagent_mark.png": "apps/electron/src/renderer/assets/opcagent_mark.png",
  "apps/electron/src/renderer/assets/mkagent_mark.svg": "apps/electron/src/renderer/assets/opcagent_mark.svg",
  "apps/electron/src/renderer/components/icons/MkAgentAppIcon.tsx": "apps/electron/src/renderer/components/icons/OPCAgentAppIcon.tsx",
  "docs/assets/mkagent-homepage.png": "docs/assets/opcagent-homepage.png",
  "packages/pi-agent-server/src/mkagent-metadata-schema.test.ts": "packages/pi-agent-server/src/opcagent-metadata-schema.test.ts",
  "packages/pi-agent-server/src/mkagent-metadata-schema.ts": "packages/pi-agent-server/src/opcagent-metadata-schema.ts",
  "packages/shared/src/config/sync-mkagent-bash-patterns.ts": "packages/shared/src/config/sync-opcagent-bash-patterns.ts",
  "packages/shared/tests/permissions-mkagent-sync.test.ts": "packages/shared/tests/permissions-opcagent-sync.test.ts",
};

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repoRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
  return result.stdout.toString();
}

function sha256(path: string): string {
  const content = readFileSync(resolve(repoRoot, path));
  const text = content.toString("utf8");
  const normalized = !content.includes(0) && Buffer.from(text, "utf8").equals(content)
    ? Buffer.from(text.replaceAll("\r\n", "\n"), "utf8")
    : content;
  return createHash("sha256")
    .update(normalized)
    .digest("hex");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const restored = JSON.parse(
  readFileSync(resolve(import.meta.dir, "craft-restored-sources.json"), "utf8"),
) as RestoredManifest;
const changedPaths = git([
  "diff",
  "--name-only",
  "--diff-filter=AMCR",
  "-z",
  restored.productBaseline,
  "--",
])
  .split("\0")
  .filter(Boolean);
const untrackedPaths = git(["ls-files", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean);
const paths = [...new Set([...changedPaths, ...untrackedPaths])];

for (const [from, to] of Object.entries(renames)) {
  delete manifest.modified[from];
  delete manifest.mkOnly[from];
  if (!existsSync(resolve(repoRoot, to))) throw new Error(`missing rename destination: ${to}`);
}

for (const path of [...paths, "scripts/update-craft-brand-overrides.ts"]) {
  if (path === selfPath || !existsSync(resolve(repoRoot, path))) continue;
  const entry = manifest.modified[path] ?? manifest.mkOnly[path];
  const next = { sha256: sha256(path), reason: entry?.reason?.trim() || reason };
  if (entry && path in manifest.modified) manifest.modified[path] = next;
  else manifest.mkOnly[path] = next;
}

manifest.renamed = Object.fromEntries(
  Object.entries(renames).map(([from, to]) => [from, { to, reason }]),
);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Pinned ${paths.length} changed paths and ${Object.keys(renames).length} renames.`);
